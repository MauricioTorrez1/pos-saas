package io.github.mauriciotorrez1.pos.core.inventory;

import java.math.BigInteger;
import java.util.OptionalLong;
import java.util.UUID;

/**
 * The weighted average cost of a product and what its stock is worth.
 *
 * @param productId     the product
 * @param quantityMilli stock in thousandths; zero or negative when more was sold than received
 * @param averageCostE6 average cost of one unit in millionths of a peso (ADR 0011), or {@code null} if no entry with a
 *                      cost has happened yet
 */
public record ProductCost(UUID productId, long quantityMilli, Long averageCostE6) {

    /** Millionths of a peso times thousandths of a unit, divided by this, give cents (1e6 x 1e3 / 100). */
    private static final BigInteger E6_MILLI_PER_CENT = BigInteger.valueOf(10_000_000L);

    /**
     * Returns the average cost, if known.
     *
     * @return the cost in millionths of a peso, or empty when no entry had a cost
     */
    public OptionalLong averageCost() {
        return averageCostE6 == null ? OptionalLong.empty() : OptionalLong.of(averageCostE6);
    }

    /**
     * Returns what the stock is worth in cents: {@code quantity x average cost}, rounded half up. Stock at or below
     * zero is worth zero, because a shortage is not an asset, and a product without a known cost is worth zero too.
     *
     * @return the value in cents, never negative
     */
    public long valueCents() {
        if (averageCostE6 == null || quantityMilli <= 0) {
            return 0;
        }
        return AverageCostCalculator.roundHalfUp(
                BigInteger.valueOf(quantityMilli).multiply(BigInteger.valueOf(averageCostE6)), E6_MILLI_PER_CENT);
    }
}
