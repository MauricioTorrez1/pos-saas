package io.github.mauriciotorrez1.pos.money;

import java.util.Objects;

/**
 * Calculates sale line amounts with integers only, as defined in ADR 0011.
 *
 * <p>Every module of the core needs this, so it lives outside them (ADR 0020). The register does the same
 * calculation in TypeScript, and the cases in packages/contracts keep both equal.
 */
public final class LineAmount {

    /** Ten-thousandths of a peso times thousandths of a unit, per cent. */
    private static final long SCALE_PER_CENT = 100_000L;

    private static final long HALF_CENT = SCALE_PER_CENT / 2;

    private LineAmount() {}

    /**
     * Calculates the amount of a sale line, rounding half up. Each line is rounded on its own, and the total of a
     * sale is the sum of its lines.
     *
     * @param unitPrice the price per unit: $12.50 is 125000
     * @param quantity what was sold: 3.275 m is 3275 meter thousandths
     * @return the amount: 4094 cents is $40.94
     * @throws MoneyException with {@code OVERFLOW} if the calculation exceeds the range of a long
     */
    public static Money of(UnitPrice unitPrice, Quantity quantity) {
        Objects.requireNonNull(unitPrice, "unitPrice");
        Objects.requireNonNull(quantity, "quantity");
        try {
            // multiplyExact and addExact fail instead of wrapping around to a negative number.
            long roundedUpByHalfCent =
                    Math.addExact(Math.multiplyExact(unitPrice.e4(), quantity.milli()), HALF_CENT);
            return new Money(roundedUpByHalfCent / SCALE_PER_CENT);
        } catch (ArithmeticException e) {
            throw new MoneyException(
                    MoneyErrorCode.OVERFLOW,
                    "%d times %d exceeds the supported range".formatted(unitPrice.e4(), quantity.milli()),
                    e);
        }
    }
}
