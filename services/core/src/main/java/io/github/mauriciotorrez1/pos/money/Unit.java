package io.github.mauriciotorrez1.pos.money;

import java.util.Arrays;
import java.util.Locale;

/** The base units of ADR 0011. A roll or a box converts to one of these. */
public enum Unit {
    PIECE,
    METER,
    KILOGRAM,
    LITER;

    /**
     * Returns the unit as the database, the shared cases, and TypeScript write it.
     *
     * @return the unit in lower case: {@code meter}
     */
    public String code() {
        return name().toLowerCase(Locale.ROOT);
    }

    /**
     * Finds a unit by its code.
     *
     * @param code the unit in lower case: {@code meter}
     * @return the unit
     * @throws MoneyException with {@code UNKNOWN_UNIT} if no unit has that code
     */
    public static Unit fromCode(String code) {
        return Arrays.stream(values())
                .filter(unit -> unit.code().equals(code))
                .findFirst()
                .orElseThrow(() -> new MoneyException(
                        MoneyErrorCode.UNKNOWN_UNIT, "Expected piece, meter, kilogram, or liter, got %s".formatted(code)));
    }
}
