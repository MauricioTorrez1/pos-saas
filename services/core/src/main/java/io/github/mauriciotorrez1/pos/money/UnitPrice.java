package io.github.mauriciotorrez1.pos.money;

/**
 * A price per unit in ten-thousandths of a peso: $12.50 is {@code new UnitPrice(125000)}, and a screw from a box of
 * 1,000 at $153 is {@code new UnitPrice(1530)}.
 *
 * @param e4 the price in ten-thousandths of a peso
 */
public record UnitPrice(long e4) {

    private static final int DECIMALS = 4;

    /**
     * Checks the price.
     *
     * @throws MoneyException with {@code NEGATIVE_INPUT} or {@code OVERFLOW}
     */
    public UnitPrice {
        ValueLimits.requireWithinLimits(e4, "a unit price");
    }

    /**
     * Reads a price written as text, such as a price from the catalog: "12.50" is 125000.
     *
     * @param text digits with up to 4 decimals, without a peso sign or commas
     * @return the price
     * @throws MoneyException with {@code INVALID_FORMAT}, {@code TOO_MANY_DECIMALS}, or {@code OVERFLOW}
     */
    public static UnitPrice parse(String text) {
        return new UnitPrice(DecimalText.read(text, DECIMALS));
    }
}
