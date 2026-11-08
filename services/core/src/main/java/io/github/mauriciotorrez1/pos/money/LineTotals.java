package io.github.mauriciotorrez1.pos.money;

import java.util.Objects;

/**
 * What a sale line keeps for the ticket and the invoice: the base without VAT, the VAT, and the total the customer
 * pays. The base is rounded half up and the VAT is the rest, so the base plus the VAT is always the total (ADR 0023).
 * The register does the same calculation in TypeScript, and the cases in packages/contracts keep both equal.
 *
 * @param subtotal the base without VAT, which the invoice calls {@code Base}
 * @param tax the VAT, zero for a product at 0% or exempt
 * @param total what the customer pays for the line, VAT included
 * @param taxRate the rate the line was sold at. A later change of rate does not change the line
 */
public record LineTotals(Money subtotal, Money tax, Money total, TaxRate taxRate) {

    /** 100% in basis points: a total that includes 16% VAT is 11600 / 10000 of its base. */
    private static final long BASIS_POINTS_PER_UNIT = 10_000L;

    /**
     * Checks that the base and the VAT come from the total and the rate.
     *
     * @throws IllegalArgumentException if they do not: build lines with {@link #of} or {@link #fromTaxIncluded}
     */
    public LineTotals {
        Objects.requireNonNull(subtotal, "subtotal");
        Objects.requireNonNull(tax, "tax");
        Objects.requireNonNull(total, "total");
        Objects.requireNonNull(taxRate, "taxRate");
        long expectedSubtotal = subtotalCents(total.cents(), taxRate);
        if (subtotal.cents() != expectedSubtotal || tax.cents() != total.cents() - expectedSubtotal) {
            throw new IllegalArgumentException("A total of %d at %s splits into %d and %d, got %d and %d"
                    .formatted(
                            total.cents(),
                            taxRate,
                            expectedSubtotal,
                            total.cents() - expectedSubtotal,
                            subtotal.cents(),
                            tax.cents()));
        }
    }

    /**
     * Calculates a sale line, VAT included: its amount as in ADR 0011, split into base and VAT as in ADR 0023.
     *
     * @param unitPrice the price per unit with VAT: $12.50 is 125000
     * @param quantity what was sold: 3.275 m is 3275 meter thousandths
     * @param taxRate the VAT of the product
     * @return the base, the VAT, and the total: 3.275 m at $12.50 and 16% is 3529 plus 565 cents
     * @throws MoneyException with {@code OVERFLOW} if the amount exceeds the range of a long
     */
    public static LineTotals of(UnitPrice unitPrice, Quantity quantity, TaxRate taxRate) {
        return fromTaxIncluded(LineAmount.of(unitPrice, quantity), taxRate);
    }

    /**
     * Splits the VAT out of an amount that includes it.
     *
     * @param total the amount the customer pays, VAT included
     * @param taxRate the VAT of the product
     * @return the base, the VAT, and the total: 4094 cents at 16% is 3529 plus 565
     */
    public static LineTotals fromTaxIncluded(Money total, TaxRate taxRate) {
        Objects.requireNonNull(total, "total");
        Objects.requireNonNull(taxRate, "taxRate");
        long subtotal = subtotalCents(total.cents(), taxRate);
        return new LineTotals(new Money(subtotal), new Money(total.cents() - subtotal), total, taxRate);
    }

    /**
     * Calculates round_half_up(total × 10000 / (10000 + rate)) without multiplying the whole total, so nothing can
     * overflow, as in TypeScript.
     */
    private static long subtotalCents(long totalCents, TaxRate taxRate) {
        if (taxRate.factor() == TaxFactor.EXEMPT) {
            return totalCents;
        }
        long divisor = BASIS_POINTS_PER_UNIT + taxRate.bp();
        // total = quotient × divisor + remainder, so total × 10000 / divisor = quotient × 10000 + remainder × 10000 /
        // divisor. The remainder is below 20001, so its product stays small. Adding half the divisor rounds half up.
        long quotient = totalCents / divisor;
        long remainder = totalCents % divisor;
        long roundedRemainder = (2 * remainder * BASIS_POINTS_PER_UNIT + divisor) / (2 * divisor);
        return quotient * BASIS_POINTS_PER_UNIT + roundedRemainder;
    }
}
