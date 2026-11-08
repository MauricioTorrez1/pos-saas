package io.github.mauriciotorrez1.pos.money;

import java.util.Objects;

/**
 * The VAT of a product: 16% is {@code TaxRate.of(1600)}, and exempt is {@link #EXEMPT} (ADR 0023).
 *
 * @param factor a rate or exempt
 * @param bp the rate in basis points, from 0 to 10000: 16% is 1600. Exempt is always 0
 */
public record TaxRate(TaxFactor factor, int bp) {

    /** 100% in basis points, the highest rate accepted. The catalog decides which rates it offers (F0-17). */
    public static final int MAX_BP = 10_000;

    /** An exempt product: it pays no VAT, and the invoice says so. */
    public static final TaxRate EXEMPT = new TaxRate(TaxFactor.EXEMPT, 0);

    /**
     * Checks the rate.
     *
     * @throws MoneyException with {@code NEGATIVE_INPUT}, or {@code INVALID_TAX_RATE} for a rate above 100% or an
     *     exempt product with a rate
     */
    public TaxRate {
        Objects.requireNonNull(factor, "factor");
        ValueLimits.requireWithinLimits(bp, "a tax rate in basis points");
        if (bp > MAX_BP) {
            throw new MoneyException(
                    MoneyErrorCode.INVALID_TAX_RATE,
                    "Expected a rate of at most %d basis points, got %d".formatted(MAX_BP, bp));
        }
        if (factor == TaxFactor.EXEMPT && bp != 0) {
            throw new MoneyException(
                    MoneyErrorCode.INVALID_TAX_RATE,
                    "An exempt product has no rate, got %d basis points".formatted(bp));
        }
    }

    /**
     * Creates a rate, including 0%.
     *
     * @param bp the rate in basis points: 16% is 1600
     * @return the rate
     * @throws MoneyException with {@code NEGATIVE_INPUT} or {@code INVALID_TAX_RATE}
     */
    public static TaxRate of(int bp) {
        return new TaxRate(TaxFactor.RATE, bp);
    }
}
