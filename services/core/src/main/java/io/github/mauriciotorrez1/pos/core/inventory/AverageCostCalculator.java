package io.github.mauriciotorrez1.pos.core.inventory;

import java.math.BigInteger;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * Replays the stock ledger of one product and returns its weighted moving average cost (RF-033, ADR 0049).
 * It is a pure function: the same events always give the same result, whatever order they were received in,
 * because they are replayed by the moment they happened.
 *
 * <p>Rules, with {@code stock} and {@code avg} as the state before the event:
 * <ul>
 *   <li><b>Receipt</b> of {@code q} at cost {@code c}: {@code avg = round_half_up((stock x avg + q x c) / (stock + q))}.</li>
 *   <li><b>Sale</b>: leaves at {@code avg}, which does not change; the cost of that sale line is remembered.</li>
 *   <li><b>Return</b>: comes back at the cost of the original sale line, so it changes the average only if the
 *       average moved since the sale. If that cost is unknown, it comes back at {@code avg}.</li>
 *   <li><b>Adjustment or write-off</b>: valued at {@code avg}, so the average does not change.</li>
 *   <li><b>Stock at or below zero</b> (more was sold than received): the missing units have no cost to blend with, so
 *       when stock becomes positive again the average is the cost of what came in. While it stays at or below zero
 *       the average is kept. With no cost known at all, the average stays unknown ({@code null}).</li>
 * </ul>
 * Amounts are integers: the average has the scale of the unit cost, millionths of a peso (ADR 0011).
 */
final class AverageCostCalculator {

    private AverageCostCalculator() {
    }

    /**
     * Computes the cost state after replaying the events of one product.
     *
     * @param productId the product
     * @param events    its events, in any order
     * @return stock and average cost after the last event
     * @throws ArithmeticException if a result does not fit a {@code long}
     */
    static ProductCost replay(UUID productId, List<CostEvent> events) {
        State state = new State();
        Map<UUID, Long> costOfSaleLine = new HashMap<>();
        for (CostEvent event : events.stream().sorted(CostEvent.REPLAY_ORDER).toList()) {
            switch (event.kind()) {
                case RECEIPT -> state.enter(event.quantityMilli(), event.unitCostE6());
                case SALE -> {
                    costOfSaleLine.put(event.saleLineId(), state.average);
                    state.stock = Math.subtractExact(state.stock, event.quantityMilli());
                }
                // A sale line that is not known (a return that predates its sale by clock skew) comes back at the average.
                case RETURN -> state.enter(event.quantityMilli(),
                        costOfSaleLine.getOrDefault(event.saleLineId(), state.average));
                case ADJUSTMENT -> {
                    if (event.quantityMilli() > 0) {
                        state.enter(event.quantityMilli(), state.average);
                    } else {
                        state.stock = Math.addExact(state.stock, event.quantityMilli());
                    }
                }
            }
        }
        return new ProductCost(productId, state.stock, state.average);
    }

    /**
     * Divides and rounds half up. Both arguments are positive or zero, as every amount here is.
     *
     * @param numerator   the dividend, zero or positive
     * @param denominator the divisor, positive
     * @return the quotient rounded half up
     * @throws ArithmeticException if the result does not fit a {@code long}
     */
    static long roundHalfUp(BigInteger numerator, BigInteger denominator) {
        BigInteger[] quotientAndRemainder = numerator.divideAndRemainder(denominator);
        BigInteger rounded = quotientAndRemainder[1].shiftLeft(1).compareTo(denominator) >= 0
                ? quotientAndRemainder[0].add(BigInteger.ONE) : quotientAndRemainder[0];
        return rounded.longValueExact();
    }

    private static final class State {

        private long stock;
        private Long average;

        /** Adds units at a cost; a {@code null} cost means the units are valued at the current average. */
        void enter(long quantityMilli, Long unitCostE6) {
            long after = Math.addExact(stock, quantityMilli);
            if (unitCostE6 != null) {
                if (average == null) {
                    average = unitCostE6;
                } else if (stock <= 0) {
                    average = after > 0 ? unitCostE6 : average;
                } else {
                    BigInteger total = BigInteger.valueOf(stock).multiply(BigInteger.valueOf(average))
                            .add(BigInteger.valueOf(quantityMilli).multiply(BigInteger.valueOf(unitCostE6)));
                    average = roundHalfUp(total, BigInteger.valueOf(after));
                }
            }
            stock = after;
        }
    }
}
