package io.github.mauriciotorrez1.pos.money;

import java.util.Arrays;
import java.util.Locale;

/**
 * How VAT applies to a product, as CFDI 4.0 names it: a rate (Tasa), even 0%, or exempt (Exento). A 0% product and
 * an exempt one pay no VAT, but the invoice tells them apart (ADR 0023).
 */
public enum TaxFactor {
    RATE,
    EXEMPT;

    /**
     * Returns the factor as the database, the shared cases, and TypeScript write it.
     *
     * @return the factor in lower case: {@code exempt}
     */
    public String code() {
        return name().toLowerCase(Locale.ROOT);
    }

    /**
     * Finds a factor by its code.
     *
     * @param code the factor in lower case: {@code rate}
     * @return the factor
     * @throws MoneyException with {@code INVALID_TAX_RATE} if no factor has that code
     */
    public static TaxFactor fromCode(String code) {
        return Arrays.stream(values())
                .filter(factor -> factor.code().equals(code))
                .findFirst()
                .orElseThrow(() -> new MoneyException(
                        MoneyErrorCode.INVALID_TAX_RATE, "Expected rate or exempt, got %s".formatted(code)));
    }
}
