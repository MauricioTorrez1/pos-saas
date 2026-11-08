package io.github.mauriciotorrez1.pos.money;

import java.util.Locale;

/**
 * Why a money or quantity value was rejected. The register uses the same codes in TypeScript, so a shared case can
 * name the error it expects.
 */
public enum MoneyErrorCode {
    NEGATIVE_INPUT,
    UNKNOWN_UNIT,
    FRACTIONAL_PIECE,
    OVERFLOW,
    INVALID_FORMAT,
    TOO_MANY_DECIMALS;

    /**
     * Returns the code as the shared cases and TypeScript write it.
     *
     * @return the code in lower case: {@code negative_input}
     */
    public String wireName() {
        return name().toLowerCase(Locale.ROOT);
    }
}
