package io.github.mauriciotorrez1.pos.core.inventory;

import io.github.mauriciotorrez1.pos.core.reporting.AuditEntry;
import io.github.mauriciotorrez1.pos.core.reporting.AuditLog;
import io.github.mauriciotorrez1.pos.ingest.OperationRecorder;
import io.github.mauriciotorrez1.pos.ingest.Payload;
import io.github.mauriciotorrez1.pos.ingest.RegisterOperation;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Stores the stock adjustments and write-offs that a register uploads as movements of the ledger
 * (RF-021, ADR 0046). The ledger is never edited, and every adjustment also goes to the audit log in the
 * same transaction. Sales and returns are not uploaded as stock: the core derives their movements (E1-25).
 */
@Component
class StockOperationRecorder implements OperationRecorder {

    private static final String STOCK_ADJUSTED = "stock.adjusted";
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final JdbcTemplate jdbc;
    private final AuditLog auditLog;

    StockOperationRecorder(JdbcTemplate jdbc, AuditLog auditLog) {
        this.jdbc = jdbc;
        this.auditLog = auditLog;
    }

    @Override
    public Set<String> types() {
        return Set.of(STOCK_ADJUSTED);
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void record(RegisterOperation operation) {
        JsonNode payload = operation.payload();
        UUID movementId = Payload.uuid(payload, "movementId");
        UUID userId = Payload.uuid(payload, "userId");
        jdbc.update("""
                INSERT INTO stock_movement (id, op_id, product_id, type, quantity_milli, reason, user_id, occurred_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                movementId, operation.opId(), Payload.uuid(payload, "productId"), Payload.text(payload, "movementType"),
                Payload.number(payload, "quantityMilli"), Payload.text(payload, "reason"), userId,
                Payload.at(operation.occurredAt()));
        ObjectNode value = JSON.createObjectNode();
        value.put("productId", Payload.uuid(payload, "productId").toString());
        value.put("movementType", Payload.text(payload, "movementType"));
        value.put("quantityMilli", Payload.number(payload, "quantityMilli"));
        value.put("reason", Payload.text(payload, "reason"));
        auditLog.record(new AuditEntry(userId, "stock." + Payload.text(payload, "movementType"), "stock_movement", movementId,
                null, value.toString()));
    }
}
