package io.github.mauriciotorrez1.pos.core.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.mauriciotorrez1.pos.core.CoreApplication;
import io.github.mauriciotorrez1.pos.core.inventory.StockReceipt.Source;
import io.github.mauriciotorrez1.pos.db.PostgresTestConfiguration;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import io.github.mauriciotorrez1.pos.tenant.TenantContext;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * The average cost against a real PostgreSQL: the ledger rows are written the way the core writes them (sales and
 * returns by the register batches, entries by {@link InventoryValuation}) and the cost is replayed from them
 * (RF-033, E1-28). Row-level security is the one of production.
 */
@SpringBootTest(classes = CoreApplication.class)
@Import(PostgresTestConfiguration.class)
class InventoryValuationTest {

    private static final long PESO_E6 = 1_000_000L;
    private static final Instant T0 = Instant.parse("2026-12-01T10:00:00Z");

    @Autowired
    private InventoryValuation valuation;

    @Autowired
    @Qualifier("adminJdbc")
    private JdbcTemplate admin;

    private final UUID tenant = Uuid7.next();
    private final UUID product = Uuid7.next();

    private Instant minute(int minutes) {
        return T0.plusSeconds(60L * minutes);
    }

    private void receive(UUID forTenant, UUID forProduct, int atMinute, long quantityMilli, long unitCostE6) {
        TenantContext.runAs(forTenant, () -> valuation.recordReceipt(new StockReceipt(Uuid7.next(), forProduct,
                Source.PURCHASE, quantityMilli, unitCostE6, minute(atMinute), null)));
    }

    /** A sale of one line, written as the core writes it. Returns the id of the line. */
    private UUID sale(UUID forTenant, UUID forProduct, int atMinute, long quantityMilli) {
        UUID saleId = Uuid7.next();
        UUID lineId = Uuid7.next();
        admin.update("""
                INSERT INTO sale (tenant_id, id, op_id, register_id, folio, completed_at, subtotal_cents, tax_cents, total_cents)
                VALUES (?, ?, ?, ?, 1, ?, 100, 16, 116)
                """, forTenant, saleId, Uuid7.next(), Uuid7.next(), java.sql.Timestamp.from(minute(atMinute)));
        admin.update("""
                INSERT INTO sale_line (tenant_id, id, sale_id, line_number, product_id, product_name, unit, quantity_milli,
                                       unit_price_e4, tax_factor, tax_rate_bp, subtotal_cents, tax_cents, line_total_cents)
                VALUES (?, ?, ?, 1, ?, 'Cable THW', 'meter', ?, 10000, 'rate', 1600, 100, 16, 116)
                """, forTenant, lineId, saleId, forProduct, quantityMilli);
        return lineId;
    }

    /** A return of part of a sale line; its time is the one of its operation in sync_operation. */
    private void giveBack(UUID forTenant, UUID saleLineId, int atMinute, long quantityMilli) {
        UUID saleId = admin.queryForObject("SELECT sale_id FROM sale_line WHERE tenant_id = ? AND id = ?", UUID.class,
                forTenant, saleLineId);
        UUID opId = Uuid7.next();
        UUID returnId = Uuid7.next();
        admin.update("""
                INSERT INTO sync_operation (tenant_id, op_id, register_id, type, schema_version, occurred_at, status, raw_operation)
                VALUES (?, ?, ?, 'sale.returned', 1, ?, 'accepted', '{}'::jsonb)
                """, forTenant, opId, Uuid7.next(), java.sql.Timestamp.from(minute(atMinute)));
        admin.update("""
                INSERT INTO sale_return (tenant_id, id, op_id, sale_id, cash_session_id, requested_by, authorized_by, reason, total_cents)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'Wrong item', 10)
                """, forTenant, returnId, opId, saleId, Uuid7.next(), Uuid7.next(), Uuid7.next());
        admin.update("INSERT INTO sale_return_line (tenant_id, id, return_id, sale_line_id, quantity_milli, refund_cents) VALUES (?, ?, ?, ?, ?, 10)",
                forTenant, Uuid7.next(), returnId, saleLineId, quantityMilli);
    }

    private void adjust(UUID forTenant, UUID forProduct, int atMinute, String type, long signedQuantityMilli) {
        admin.update("""
                INSERT INTO stock_movement (tenant_id, id, op_id, product_id, type, quantity_milli, reason, user_id, occurred_at)
                VALUES (?, ?, ?, ?, ?, ?, 'Count', ?, ?)
                """, forTenant, Uuid7.next(), Uuid7.next(), forProduct, type, signedQuantityMilli, Uuid7.next(),
                java.sql.Timestamp.from(minute(atMinute)));
    }

    private ProductCost cost(UUID forTenant, UUID forProduct) {
        return TenantContext.callAs(forTenant, () -> valuation.costOf(forProduct));
    }

    @Test
    void theExampleOfTheCardTwoPurchasesAReturnAndAWriteOff() {
        receive(tenant, product, 0, 10_000, 10 * PESO_E6);
        receive(tenant, product, 1, 30_000, 20 * PESO_E6);
        UUID line = sale(tenant, product, 2, 5_000);
        giveBack(tenant, line, 3, 1_000);
        adjust(tenant, product, 4, "waste", -2_000);

        ProductCost cost = cost(tenant, product);

        // 40 received, 5 sold, 1 returned, 2 written off: 34. The average stays at $17.50 throughout.
        assertThat(cost.quantityMilli()).isEqualTo(34_000);
        assertThat(cost.averageCostE6()).isEqualTo(17_500_000);
        assertThat(cost.valueCents()).isEqualTo(59_500);
    }

    @Test
    void recalculatingFromScratchGivesTheSameResultEveryTime() {
        receive(tenant, product, 0, 7_000, 12_345_678);
        UUID line = sale(tenant, product, 1, 2_500);
        receive(tenant, product, 2, 3_333, 9_876_543);
        giveBack(tenant, line, 3, 500);

        ProductCost first = cost(tenant, product);

        assertThat(cost(tenant, product)).isEqualTo(first);
        assertThat(TenantContext.callAs(tenant, valuation::inventoryValue).products()).containsExactly(first);
    }

    @Test
    void aSaleReceivedLateIsValuedAtTheCostOfItsOwnMoment() {
        receive(tenant, product, 0, 10_000, 10 * PESO_E6);
        receive(tenant, product, 10, 10_000, 30 * PESO_E6);
        // The register was offline: this sale from minute 5 is written after the purchase of minute 10.
        UUID line = sale(tenant, product, 5, 4_000);
        giveBack(tenant, line, 11, 4_000);

        ProductCost cost = cost(tenant, product);

        // Valued at $10.00 when it happened, and returned at that cost: (16 x 22.5 + 4 x 10) / 20 = $20.00.
        assertThat(cost.quantityMilli()).isEqualTo(20_000);
        assertThat(cost.averageCostE6()).isEqualTo(20_000_000);
    }

    @Test
    void anEntryRecordedLateIsReplayedAtTheMomentTheGoodsArrived() {
        receive(tenant, product, 10, 10_000, 30 * PESO_E6);
        sale(tenant, product, 6, 2_000);
        // The purchase of minute 0 is typed in afterwards.
        receive(tenant, product, 0, 10_000, 10 * PESO_E6);

        ProductCost cost = cost(tenant, product);

        // 10 at $10.00, 2 sold, then 10 at $30.00: (8 x 10 + 10 x 30) / 18 = $21.111111.
        assertThat(cost.quantityMilli()).isEqualTo(18_000);
        assertThat(cost.averageCostE6()).isEqualTo(21_111_111);
    }

    @Test
    void zeroAndNegativeStockAreKeptAndDocumented() {
        receive(tenant, product, 0, 2_000, 5 * PESO_E6);
        sale(tenant, product, 1, 5_000);

        ProductCost negative = cost(tenant, product);
        assertThat(negative.quantityMilli()).isEqualTo(-3_000);
        assertThat(negative.averageCostE6()).isEqualTo(5_000_000);
        assertThat(negative.valueCents()).isZero();

        receive(tenant, product, 2, 10_000, 9 * PESO_E6);
        ProductCost recovered = cost(tenant, product);
        assertThat(recovered.quantityMilli()).isEqualTo(7_000);
        assertThat(recovered.averageCostE6()).isEqualTo(9_000_000);
    }

    @Test
    void theValueOfTheInventoryAddsEveryProductAndCountsThoseWithoutCost() {
        UUID other = Uuid7.next();
        UUID neverBought = Uuid7.next();
        receive(tenant, product, 0, 10_000, 10 * PESO_E6);
        receive(tenant, other, 0, 2_500, 4 * PESO_E6);
        adjust(tenant, neverBought, 0, "adjustment", 3_000);

        InventoryValue value = TenantContext.callAs(tenant, valuation::inventoryValue);

        // 10 x $10.00 + 2.5 x $4.00 = $110.00; the adjusted product has stock but no cost, so it is worth zero.
        assertThat(value.totalCents()).isEqualTo(11_000);
        assertThat(value.products()).hasSize(3);
        assertThat(value.productsWithoutCost()).isEqualTo(1);
    }

    @Test
    void aProductWithoutMovementsHasNoStockAndNoCost() {
        ProductCost cost = cost(tenant, Uuid7.next());

        assertThat(cost.quantityMilli()).isZero();
        assertThat(cost.averageCost()).isEmpty();
    }

    @Test
    void repeatingAnEntryStoresItOnceAndWritesOneAuditLine() {
        StockReceipt receipt = new StockReceipt(Uuid7.next(), product, Source.OPENING_BALANCE, 1_000, 2 * PESO_E6, minute(0), Uuid7.next());

        boolean first = TenantContext.callAs(tenant, () -> valuation.recordReceipt(receipt));
        boolean second = TenantContext.callAs(tenant, () -> valuation.recordReceipt(receipt));

        assertThat(first).isTrue();
        assertThat(second).isFalse();
        assertThat(admin.queryForObject("SELECT count(*) FROM stock_receipt WHERE tenant_id = ? AND product_id = ?", Integer.class,
                tenant, product)).isEqualTo(1);
        assertThat(admin.queryForObject("SELECT count(*) FROM audit_log WHERE tenant_id = ? AND action = 'stock.received' AND new_value ->> 'productId' = ?",
                Integer.class, tenant, product.toString())).isEqualTo(1);
    }

    @Test
    void aBusinessNeverSeesTheCostOrTheStockOfAnother() {
        UUID other = Uuid7.next();
        receive(tenant, product, 0, 10_000, 10 * PESO_E6);
        sale(tenant, product, 1, 2_000);
        receive(other, product, 0, 5_000, 99 * PESO_E6);

        assertThat(cost(tenant, product).averageCostE6()).isEqualTo(10_000_000);
        assertThat(cost(tenant, product).quantityMilli()).isEqualTo(8_000);
        assertThat(cost(other, product).averageCostE6()).isEqualTo(99_000_000);
        assertThat(cost(other, product).quantityMilli()).isEqualTo(5_000);
        assertThat(TenantContext.callAs(other, valuation::inventoryValue).totalCents()).isEqualTo(49_500);
    }

    @Test
    void theEntriesAreALedgerAndCannotBeEditedOrDeleted() {
        receive(tenant, product, 0, 1_000, PESO_E6);

        assertThatThrownBy(() -> admin.update("UPDATE stock_receipt SET unit_cost_e6 = 1 WHERE tenant_id = ?", tenant))
                .isInstanceOf(DataAccessException.class).hasStackTraceContaining("stock_receipt is append-only");
        assertThatThrownBy(() -> admin.update("DELETE FROM stock_receipt WHERE tenant_id = ?", tenant))
                .isInstanceOf(DataAccessException.class).hasStackTraceContaining("stock_receipt is append-only");
    }

    @Test
    void anEntryWithoutStockOrWithANegativeCostIsRefused() {
        assertThatThrownBy(() -> new StockReceipt(Uuid7.next(), product, Source.PURCHASE, 0, PESO_E6, minute(0), null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new StockReceipt(Uuid7.next(), product, Source.PURCHASE, 1, -1, minute(0), null))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
