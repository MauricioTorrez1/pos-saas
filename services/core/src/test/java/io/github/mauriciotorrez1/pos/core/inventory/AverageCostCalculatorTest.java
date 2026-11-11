package io.github.mauriciotorrez1.pos.core.inventory;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.mauriciotorrez1.pos.core.inventory.CostEvent.Kind;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** The weighted moving average cost and its edge cases, with no database (RF-033, ADR 0049). */
class AverageCostCalculatorTest {

    private static final long PESO_E6 = 1_000_000L;
    private static final Instant T0 = Instant.parse("2026-12-01T10:00:00Z");

    private final UUID product = Uuid7.next();

    private CostEvent receipt(int minute, long quantityMilli, long unitCostE6) {
        return new CostEvent(Kind.RECEIPT, T0.plusSeconds(60L * minute), Uuid7.next(), product, quantityMilli, unitCostE6, null);
    }

    private CostEvent sale(int minute, UUID saleLine, long quantityMilli) {
        return new CostEvent(Kind.SALE, T0.plusSeconds(60L * minute), Uuid7.next(), product, quantityMilli, null, saleLine);
    }

    private CostEvent giveBack(int minute, UUID saleLine, long quantityMilli) {
        return new CostEvent(Kind.RETURN, T0.plusSeconds(60L * minute), Uuid7.next(), product, quantityMilli, null, saleLine);
    }

    private CostEvent adjustment(int minute, long signedQuantityMilli) {
        return new CostEvent(Kind.ADJUSTMENT, T0.plusSeconds(60L * minute), Uuid7.next(), product, signedQuantityMilli, null, null);
    }

    private ProductCost replay(CostEvent... events) {
        return AverageCostCalculator.replay(product, List.of(events));
    }

    @Test
    void twoPurchasesAtDifferentCostsGiveTheWeightedAverage() {
        // 10 pieces at $10.00 and 30 pieces at $20.00: (10 x 10 + 30 x 20) / 40 = $17.50.
        ProductCost cost = replay(receipt(0, 10_000, 10 * PESO_E6), receipt(1, 30_000, 20 * PESO_E6));

        assertThat(cost.quantityMilli()).isEqualTo(40_000);
        assertThat(cost.averageCostE6()).isEqualTo(17_500_000);
        assertThat(cost.valueCents()).isEqualTo(70_000);
    }

    @Test
    void theAverageKeepsSixDecimalsAndRoundsHalfUp() {
        // 1 unit at 0.100000 and 2 units at 0.100001: 0.3000020 / 3 = 0.10000066... rounds up to 0.100001.
        assertThat(replay(receipt(0, 1_000, 100_000), receipt(1, 2_000, 100_001)).averageCostE6()).isEqualTo(100_001);
        // An exact tie: 1 unit at 1 and 1 unit at 2 is 1.5 millionths, which rounds half up to 2.
        assertThat(replay(receipt(0, 1_000, 1), receipt(1, 1_000, 2)).averageCostE6()).isEqualTo(2);
        // Just under the tie rounds down: (2 x 1 + 1 x 2) / 3 = 1.33.
        assertThat(replay(receipt(0, 2_000, 1), receipt(1, 1_000, 2)).averageCostE6()).isEqualTo(1);
    }

    @Test
    void aSaleLeavesTheAverageUntouched() {
        ProductCost cost = replay(receipt(0, 10_000, 10 * PESO_E6), receipt(1, 30_000, 20 * PESO_E6),
                sale(2, Uuid7.next(), 5_000));

        assertThat(cost.quantityMilli()).isEqualTo(35_000);
        assertThat(cost.averageCostE6()).isEqualTo(17_500_000);
    }

    @Test
    void aReturnComesBackAtTheCostOfTheOriginalSaleEvenIfTheAverageMovedSince() {
        UUID line = Uuid7.next();
        // Sold at $10.00; a purchase at $30.00 follows; then the sale is returned at $10.00, not at the new average.
        ProductCost cost = replay(receipt(0, 10_000, 10 * PESO_E6), sale(1, line, 2_000),
                receipt(2, 8_000, 30 * PESO_E6), giveBack(3, line, 2_000));

        // Before the return: 8 units at $10.00 plus 8 at $30.00 = $20.00. The 2 units return at $10.00:
        // (16 x 20 + 2 x 10) / 18 = $18.888889.
        assertThat(cost.quantityMilli()).isEqualTo(18_000);
        assertThat(cost.averageCostE6()).isEqualTo(18_888_889);
    }

    @Test
    void aReturnDoesNotChangeTheAverageWhenTheCostDidNotMove() {
        UUID line = Uuid7.next();
        ProductCost cost = replay(receipt(0, 3_000, 33_333_333), sale(1, line, 1_000), giveBack(2, line, 1_000));

        assertThat(cost.quantityMilli()).isEqualTo(3_000);
        assertThat(cost.averageCostE6()).isEqualTo(33_333_333);
    }

    @Test
    void aWriteOffAndAnAdjustmentAreValuedAtTheCurrentAverage() {
        ProductCost cost = replay(receipt(0, 10_000, 10 * PESO_E6), receipt(1, 10_000, 20 * PESO_E6),
                adjustment(2, -2_500), adjustment(3, 1_000));

        assertThat(cost.quantityMilli()).isEqualTo(18_500);
        assertThat(cost.averageCostE6()).isEqualTo(15_000_000);
        assertThat(cost.valueCents()).isEqualTo(27_750);
    }

    @Test
    void stockAtZeroIsWorthZeroAndTheAverageIsKeptForTheNextSale() {
        UUID line = Uuid7.next();
        ProductCost cost = replay(receipt(0, 4_000, 5 * PESO_E6), sale(1, line, 4_000));

        assertThat(cost.quantityMilli()).isZero();
        assertThat(cost.averageCostE6()).isEqualTo(5_000_000);
        assertThat(cost.valueCents()).isZero();
    }

    @Test
    void negativeStockIsWorthZeroAndTheAverageIsKeptWhileItStaysNegative() {
        ProductCost cost = replay(receipt(0, 2_000, 5 * PESO_E6), sale(1, Uuid7.next(), 5_000),
                receipt(2, 1_000, 9 * PESO_E6));

        // -3 units, then +1 unit: still -2, so there is nothing to blend and the average stays.
        assertThat(cost.quantityMilli()).isEqualTo(-2_000);
        assertThat(cost.averageCostE6()).isEqualTo(5_000_000);
        assertThat(cost.valueCents()).isZero();
    }

    @Test
    void whenStockRecoversFromNegativeTheAverageIsTheCostOfWhatCameIn() {
        ProductCost cost = replay(receipt(0, 2_000, 5 * PESO_E6), sale(1, Uuid7.next(), 5_000),
                receipt(2, 10_000, 9 * PESO_E6));

        // -3 units, then +10: 7 remain and all of them come from the $9.00 purchase.
        assertThat(cost.quantityMilli()).isEqualTo(7_000);
        assertThat(cost.averageCostE6()).isEqualTo(9_000_000);
    }

    @Test
    void aSaleBeforeAnyPurchaseHasNoKnownCostUntilTheFirstPurchaseArrives() {
        ProductCost beforePurchase = replay(sale(0, Uuid7.next(), 1_000));
        ProductCost afterPurchase = replay(sale(0, Uuid7.next(), 1_000), receipt(1, 5_000, 7 * PESO_E6));

        assertThat(beforePurchase.quantityMilli()).isEqualTo(-1_000);
        assertThat(beforePurchase.averageCost()).isEmpty();
        assertThat(beforePurchase.valueCents()).isZero();
        assertThat(afterPurchase.quantityMilli()).isEqualTo(4_000);
        assertThat(afterPurchase.averageCostE6()).isEqualTo(7_000_000);
    }

    @Test
    void aReturnOfASaleWithoutKnownCostEntersAtTheCurrentAverage() {
        UUID line = Uuid7.next();
        ProductCost cost = replay(sale(0, line, 1_000), receipt(1, 3_000, 4 * PESO_E6), giveBack(2, line, 1_000));

        assertThat(cost.quantityMilli()).isEqualTo(3_000);
        assertThat(cost.averageCostE6()).isEqualTo(4_000_000);
    }

    @Test
    void aSaleThatArrivesLateIsValuedAtTheAverageOfItsOwnMoment() {
        // The sale happened between the two purchases, but its event is listed last, as if it had synced late.
        UUID line = Uuid7.next();
        List<CostEvent> arrival = List.of(receipt(0, 10_000, 10 * PESO_E6), receipt(10, 10_000, 30 * PESO_E6),
                sale(5, line, 4_000), giveBack(11, line, 4_000));

        ProductCost cost = AverageCostCalculator.replay(product, arrival);

        // Sold at $10.00 (before the second purchase): 6 units left, then 6 at $10 and 10 at $30 average $22.50.
        // The 4 units return at the $10.00 of the sale: (16 x 22.5 + 4 x 10) / 20 = $20.00.
        assertThat(cost.quantityMilli()).isEqualTo(20_000);
        assertThat(cost.averageCostE6()).isEqualTo(20_000_000);
    }

    @Test
    void theResultDoesNotDependOnTheOrderTheEventsArriveIn() {
        UUID line = Uuid7.next();
        List<CostEvent> events = new ArrayList<>(List.of(receipt(0, 10_000, 10 * PESO_E6), sale(1, line, 3_000),
                receipt(2, 20_000, 14 * PESO_E6), giveBack(3, line, 1_000), adjustment(4, -500), receipt(5, 1_500, 3 * PESO_E6)));
        ProductCost expected = AverageCostCalculator.replay(product, events);

        for (int seed = 0; seed < 20; seed++) {
            Collections.shuffle(events, new java.util.Random(seed));
            assertThat(AverageCostCalculator.replay(product, events)).isEqualTo(expected);
        }
    }

    @Test
    void eventsAtTheSameInstantReplayInAFixedOrder() {
        UUID line = Uuid7.next();
        Instant instant = T0;
        CostEvent in = new CostEvent(Kind.RECEIPT, instant, Uuid7.next(), product, 5_000, 2L * PESO_E6, null);
        CostEvent out = new CostEvent(Kind.SALE, instant, Uuid7.next(), product, 5_000, null, line);

        // Stock arrives before it leaves, whatever order they are given in.
        assertThat(AverageCostCalculator.replay(product, List.of(out, in)))
                .isEqualTo(AverageCostCalculator.replay(product, List.of(in, out)));
        assertThat(AverageCostCalculator.replay(product, List.of(out, in)).quantityMilli()).isZero();
    }

    @Test
    void largeQuantitiesAndCostsDoNotOverflowTheIntermediateProduct() {
        // 1e9 milli-units x 1e12 e6-cost = 1e21, past a long, but the average itself fits.
        ProductCost cost = replay(receipt(0, 1_000_000_000L, 1_000_000_000_000L), receipt(1, 1_000_000_000L, 3_000_000_000_000L));

        assertThat(cost.averageCostE6()).isEqualTo(2_000_000_000_000L);
    }
}
