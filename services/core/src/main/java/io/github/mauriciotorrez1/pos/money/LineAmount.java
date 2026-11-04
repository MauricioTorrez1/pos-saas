package io.github.mauriciotorrez1.pos.money;

/**
 * Calculates sale line amounts with integers only, as defined in ADR 0011.
 *
 * <p>Every module of the core needs this, so it lives outside them (ADR 0020). The register does
 * the same calculation in TypeScript, and the cases in packages/contracts keep both equal.
 */
public final class LineAmount {

    /** Ten-thousandths of a peso times thousandths of a unit, per cent. */
    private static final long SCALE_PER_CENT = 100_000L;

    private static final long HALF_CENT = SCALE_PER_CENT / 2;

    private LineAmount() {}

    /**
     * Calculates the amount of a sale line, rounding half up.
     *
     * @param unitPriceE4 unit price in ten-thousandths of a peso: $12.50 is 125000
     * @param quantityMilli quantity in thousandths of its unit: 3.275 m is 3275
     * @return the amount in cents: 4094 is $40.94
     * @throws IllegalArgumentException if an input is negative
     * @throws ArithmeticException if the calculation exceeds the range of a long
     */
    public static long inCents(long unitPriceE4, long quantityMilli) {
        if (unitPriceE4 < 0 || quantityMilli < 0) {
            throw new IllegalArgumentException(
                    "Expected non-negative values, got %d and %d".formatted(unitPriceE4, quantityMilli));
        }
        return Math.addExact(Math.multiplyExact(unitPriceE4, quantityMilli), HALF_CENT) / SCALE_PER_CENT;
    }
}
