package io.github.mauriciotorrez1.pos.money;

import java.util.Objects;

/**
 * The lines of a sale that share a factor and a rate, added up. The invoice lists one per rate in its taxes node.
 *
 * @param taxRate the factor and the rate the lines share
 * @param base the sum of the bases of the lines
 * @param tax the sum of the VAT of the lines
 */
public record TaxGroup(TaxRate taxRate, Money base, Money tax) {

    /** Checks that no part is missing. */
    public TaxGroup {
        Objects.requireNonNull(taxRate, "taxRate");
        Objects.requireNonNull(base, "base");
        Objects.requireNonNull(tax, "tax");
    }

    /**
     * Adds another group with the same rate.
     *
     * @param other the group to add
     * @return the sum of both
     */
    TaxGroup plus(TaxGroup other) {
        return new TaxGroup(taxRate, base.plus(other.base), tax.plus(other.tax));
    }
}
