package io.github.mauriciotorrez1.pos.money;

import java.util.Objects;

/**
 * An amount of something, in thousandths of its base unit: 3.275 m is {@code new Quantity(3275, Unit.METER)}.
 * Pieces are whole, as with the products sold by unit in Eleventa.
 *
 * @param milli thousandths of the unit: 3.275 m is 3275, and 7 pieces are 7000
 * @param unit the base unit
 */
public record Quantity(long milli, Unit unit) {

    private static final int DECIMALS = 3;
    private static final long MILLI_PER_UNIT = 1_000L;

    /**
     * Checks the quantity.
     *
     * @throws MoneyException with {@code NEGATIVE_INPUT}, {@code OVERFLOW}, or {@code FRACTIONAL_PIECE}
     */
    public Quantity {
        Objects.requireNonNull(unit, "unit");
        ValueLimits.requireWithinLimits(milli, "a quantity in thousandths");
        if (unit == Unit.PIECE && milli % MILLI_PER_UNIT != 0) {
            throw new MoneyException(
                    MoneyErrorCode.FRACTIONAL_PIECE, "Pieces are whole, got %d thousandths of a piece".formatted(milli));
        }
    }

    /**
     * Reads a quantity typed as text: "3.275" in meters is 3275 thousandths.
     *
     * @param text digits with up to 3 decimals
     * @param unit the base unit
     * @return the quantity
     * @throws MoneyException with {@code INVALID_FORMAT}, {@code TOO_MANY_DECIMALS}, {@code OVERFLOW}, or
     *     {@code FRACTIONAL_PIECE}
     */
    public static Quantity parse(String text, Unit unit) {
        return new Quantity(DecimalText.read(text, DECIMALS), unit);
    }
}
