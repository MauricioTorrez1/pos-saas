package io.github.mauriciotorrez1.pos.core.inventory;

import io.github.mauriciotorrez1.pos.core.reporting.AuditEntry;
import io.github.mauriciotorrez1.pos.core.reporting.AuditLog;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * The internal API of the weighted average cost (RF-033, ADR 0049): enter stock with a cost, ask for the cost of a
 * product, and ask for what the whole inventory is worth. The cost is always replayed from the ledger, so a sale
 * that arrives late, or an entry recorded late, is valued as of the moment it happened and no derived number can
 * drift from the ledger. Everything runs for the business of the current transaction (ADR 0035).
 */
@Service
public class InventoryValuation {

    private static final String STOCK_RECEIVED = "stock.received";
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final JdbcTemplate jdbc;
    private final AuditLog auditLog;

    InventoryValuation(JdbcTemplate jdbc, AuditLog auditLog) {
        this.jdbc = jdbc;
        this.auditLog = auditLog;
    }

    /**
     * Records an entry of stock with its cost, and a line in the audit log in the same transaction. Repeating the same
     * {@code opId} stores nothing and returns {@code false}.
     *
     * @param receipt the entry
     * @return {@code true} if it was stored now, {@code false} if it was already there
     */
    @Transactional
    public boolean recordReceipt(StockReceipt receipt) {
        UUID id = Uuid7.next();
        int stored = jdbc.update("""
                INSERT INTO stock_receipt (id, op_id, product_id, source, quantity_milli, unit_cost_e6, occurred_at, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (tenant_id, op_id) DO NOTHING
                """,
                id, receipt.opId(), receipt.productId(), receipt.source().code(), receipt.quantityMilli(),
                receipt.unitCostE6(), java.sql.Timestamp.from(receipt.occurredAt()), receipt.createdBy());
        if (stored == 0) {
            return false;
        }
        ObjectNode value = JSON.createObjectNode();
        value.put("productId", receipt.productId().toString());
        value.put("source", receipt.source().code());
        value.put("quantityMilli", receipt.quantityMilli());
        value.put("unitCostE6", receipt.unitCostE6());
        auditLog.record(new AuditEntry(receipt.createdBy(), STOCK_RECEIVED, "stock_receipt", id, null, value.toString()));
        return true;
    }

    /**
     * Returns the stock and average cost of one product, recalculated from the ledger.
     *
     * @param productId the product
     * @return its cost; a product without movements has zero stock and no known cost
     */
    @Transactional(readOnly = true)
    public ProductCost costOf(UUID productId) {
        return AverageCostCalculator.replay(productId, events(productId).getOrDefault(productId, List.of()));
    }

    /**
     * Returns the cost of every product that has moved and the value of the inventory.
     *
     * @return the valuation, with products in no particular order
     */
    @Transactional(readOnly = true)
    public InventoryValue inventoryValue() {
        List<ProductCost> costs = new ArrayList<>();
        events(null).forEach((product, productEvents) -> costs.add(AverageCostCalculator.replay(product, productEvents)));
        long total = costs.stream().mapToLong(ProductCost::valueCents).sum();
        int withoutCost = (int) costs.stream().filter(cost -> cost.averageCostE6() == null).count();
        return new InventoryValue(total, List.copyOf(costs), withoutCost);
    }

    /**
     * Reads the ledger of one product, or of all products when {@code productId} is {@code null}. Until the core
     * writes its own movements for sales and returns (E1-25), they are read from the sale and return lines, which
     * hold the same quantities. A return takes the moment of its operation, because the return row has no time.
     */
    private Map<UUID, List<CostEvent>> events(UUID productId) {
        String filter = productId == null ? "" : " WHERE product_id = ?";
        String sql = """
                SELECT * FROM (
                    SELECT 'RECEIPT' AS kind, id, occurred_at AS happened_at, product_id, quantity_milli, unit_cost_e6, NULL::uuid AS sale_line_id
                      FROM stock_receipt
                    UNION ALL
                    SELECT 'SALE', l.id, s.completed_at, l.product_id, l.quantity_milli, NULL, l.id
                      FROM sale_line l JOIN sale s ON s.tenant_id = l.tenant_id AND s.id = l.sale_id
                    UNION ALL
                    SELECT 'RETURN', r.id, o.occurred_at, l.product_id, r.quantity_milli, NULL, r.sale_line_id
                      FROM sale_return_line r
                      JOIN sale_line l ON l.tenant_id = r.tenant_id AND l.id = r.sale_line_id
                      JOIN sale_return h ON h.tenant_id = r.tenant_id AND h.id = r.return_id
                      JOIN sync_operation o ON o.tenant_id = h.tenant_id AND o.op_id = h.op_id
                    UNION ALL
                    SELECT 'ADJUSTMENT', id, occurred_at, product_id, quantity_milli, NULL, NULL
                      FROM stock_movement
                ) ledger""" + filter + " ORDER BY happened_at, id";
        Map<UUID, List<CostEvent>> byProduct = new LinkedHashMap<>();
        jdbc.query(sql, rs -> {
            CostEvent event = new CostEvent(CostEvent.Kind.valueOf(rs.getString("kind")),
                    rs.getTimestamp("happened_at").toInstant(), rs.getObject("id", UUID.class), rs.getObject("product_id", UUID.class),
                    rs.getLong("quantity_milli"), rs.getObject("unit_cost_e6", Long.class),
                    rs.getObject("sale_line_id", UUID.class));
            byProduct.computeIfAbsent(event.productId(), key -> new ArrayList<>()).add(event);
        }, productId == null ? new Object[0] : new Object[]{productId});
        return byProduct;
    }
}
