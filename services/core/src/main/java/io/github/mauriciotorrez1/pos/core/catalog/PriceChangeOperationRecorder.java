package io.github.mauriciotorrez1.pos.core.catalog;

import io.github.mauriciotorrez1.pos.core.reporting.AuditEntry;
import io.github.mauriciotorrez1.pos.core.reporting.AuditLog;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import io.github.mauriciotorrez1.pos.ingest.OperationRecorder;
import io.github.mauriciotorrez1.pos.ingest.OperationRejectedException;
import io.github.mauriciotorrez1.pos.ingest.Payload;
import io.github.mauriciotorrez1.pos.ingest.RegisterOperation;
import io.github.mauriciotorrez1.pos.tenant.TenantContext;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Stores the price changes that a register uploads (E1-40, ADR 0053). In one transaction it writes the change to
 * the append-only log, the audit entry (who, when, before, after: RF-040) and the {@link ProductPriceChanged} event
 * for the outbox, so none of them exists without the others.
 *
 * <p>The core never rejects a change for what it does not know yet. A product that is not in the core is kept
 * anyway, and a previous price that is not the one the core holds is kept and marked as a discrepancy (RF-022),
 * because the register is the one that charged that price.
 */
@Component
class PriceChangeOperationRecorder implements OperationRecorder {

    private static final String PRICE_CHANGED = "product.price_changed";
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final JdbcTemplate jdbc;
    private final AuditLog auditLog;
    private final ApplicationEventPublisher events;
    private final ProductCatalog catalog;

    PriceChangeOperationRecorder(JdbcTemplate jdbc, AuditLog auditLog, ApplicationEventPublisher events,
                                 ProductCatalog catalog) {
        this.jdbc = jdbc;
        this.auditLog = auditLog;
        this.events = events;
        this.catalog = catalog;
    }

    @Override
    public Set<String> types() {
        return Set.of(PRICE_CHANGED);
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void record(RegisterOperation operation) {
        JsonNode payload = operation.payload();
        UUID changeId = Payload.uuid(payload, "changeId");
        UUID productId = Payload.uuid(payload, "productId");
        long previous = Payload.number(payload, "previousUnitPriceE4");
        long current = Payload.number(payload, "newUnitPriceE4");
        UUID changedBy = Payload.uuid(payload, "changedBy");
        UUID authorizedBy = Payload.uuid(payload, "authorizedBy");

        if (exists(changeId)) {
            throw new OperationRejectedException("The price change was already recorded by another operation");
        }
        // Two changes of one product, from two registers, are turned one after the other, so each compares with the
        // price the other left. The lock is released with the transaction.
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))::text", String.class,
                "price:" + productId);
        // The catalog holds the price once the product exists in it (ADR 0056); before that, the latest change does.
        Long serverPrice = catalog.livePrice(productId).orElseGet(() -> latestPrice(productId));
        boolean discrepancy = serverPrice != null && serverPrice != previous;

        jdbc.update("""
                INSERT INTO product_price_change (id, op_id, register_id, product_id, previous_unit_price_e4,
                                                  new_unit_price_e4, changed_by, authorized_by, occurred_at,
                                                  server_price_e4, discrepancy)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                changeId, operation.opId(), operation.registerId(), productId, previous, current, changedBy,
                authorizedBy, Payload.at(operation.occurredAt()), serverPrice, discrepancy);

        auditLog.record(new AuditEntry(changedBy, "product.price_change", "product", productId,
                value(previous, null, null, null), value(current, changeId, authorizedBy, discrepancy ? serverPrice : null)));
        events.publishEvent(new ProductPriceChanged(Uuid7.next(), TenantContext.current().orElseThrow(), 1, changeId,
                productId, previous, current, changedBy, authorizedBy, operation.occurredAt(), discrepancy));
        // A product in the catalog takes the price the register charged and is republished to every register.
        catalog.applyRegisterPrice(productId, current, changedBy);
    }

    private boolean exists(UUID changeId) {
        Integer count = jdbc.queryForObject("SELECT count(*) FROM product_price_change WHERE id = ?", Integer.class, changeId);
        return count != null && count > 0;
    }

    /** The price of the latest change stored, used while the product is not in the catalog. */
    private Long latestPrice(UUID productId) {
        List<Long> latest = jdbc.queryForList(
                "SELECT new_unit_price_e4 FROM product_price_change WHERE product_id = ? ORDER BY seq DESC LIMIT 1",
                Long.class, productId);
        return latest.isEmpty() ? null : latest.get(0);
    }

    /** Ids and prices only, as the audit log asks. */
    private static String value(long unitPriceE4, UUID changeId, UUID authorizedBy, Long serverPriceE4) {
        ObjectNode value = JSON.createObjectNode();
        value.put("unitPriceE4", unitPriceE4);
        if (changeId != null) {
            value.put("changeId", changeId.toString());
            value.put("authorizedBy", authorizedBy.toString());
        }
        if (serverPriceE4 != null) {
            value.put("serverPriceE4", serverPriceE4);
        }
        return value.toString();
    }
}
