package io.github.mauriciotorrez1.pos.core.catalog;

import io.github.mauriciotorrez1.pos.money.Unit;
import java.util.Locale;

/** What a base unit measures: a count, a weight, a length, or a volume. */
public enum MeasurementKind {
    COUNT,
    WEIGHT,
    LENGTH,
    VOLUME;

    /**
     * Returns the kind of measurement of a base unit.
     *
     * @param unit the base unit of ADR 0011
     * @return the kind: {@code piece} counts, {@code kilogram} weighs, {@code meter} is a length, {@code liter} a volume
     */
    public static MeasurementKind of(Unit unit) {
        return switch (unit) {
            case PIECE -> COUNT;
            case KILOGRAM -> WEIGHT;
            case METER -> LENGTH;
            case LITER -> VOLUME;
        };
    }

    /**
     * Returns the kind as the API writes it.
     *
     * @return the lower case name, such as {@code length}
     */
    public String code() {
        return name().toLowerCase(Locale.ROOT);
    }
}
