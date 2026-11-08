package io.github.mauriciotorrez1.pos.money;

import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;

/**
 * The totals of a sale: the sum of its lines, as in CFDI 4.0, where the VAT of the invoice is the sum of the VAT of
 * its lines (ADR 0023).
 *
 * @param subtotal the sum of the bases
 * @param tax the sum of the VAT
 * @param total what the customer pays
 * @param taxGroups one group per rate, highest rate first, and exempt last
 */
public record SaleTotals(Money subtotal, Money tax, Money total, List<TaxGroup> taxGroups) {

    /** The order of the ticket and the invoice: 16%, 8%, 0%, and then exempt. */
    private static final Comparator<TaxGroup> HIGHEST_RATE_FIRST_EXEMPT_LAST = Comparator.comparing(
                    (TaxGroup group) -> group.taxRate().factor() == TaxFactor.EXEMPT)
            .thenComparing(group -> group.taxRate().bp(), Comparator.reverseOrder());

    /**
     * Checks that the subtotal plus the VAT is the total.
     *
     * @throws IllegalArgumentException if they do not add up: build the totals with {@link #of}
     */
    public SaleTotals {
        Objects.requireNonNull(subtotal, "subtotal");
        Objects.requireNonNull(tax, "tax");
        Objects.requireNonNull(total, "total");
        taxGroups = List.copyOf(taxGroups);
        if (subtotal.cents() + tax.cents() != total.cents()) {
            throw new IllegalArgumentException(
                    "%d plus %d is not %d".formatted(subtotal.cents(), tax.cents(), total.cents()));
        }
    }

    /**
     * Adds up the lines of a sale.
     *
     * @param lines the lines of the sale
     * @return the subtotal, the VAT, the total, and the VAT grouped by rate. All zero for a sale with no lines
     * @throws MoneyException with {@code OVERFLOW} if the total exceeds the largest supported value, as in TypeScript
     */
    public static SaleTotals of(List<LineTotals> lines) {
        Money total = sum(lines, LineTotals::total);
        // Bases and VAT are parts of the totals, so their sums stay within the limit once the total did.
        return new SaleTotals(
                sum(lines, LineTotals::subtotal), sum(lines, LineTotals::tax), total, groupByTaxRate(lines));
    }

    private static Money sum(List<LineTotals> lines, Function<LineTotals, Money> part) {
        return Money.sum(lines.stream().map(part).toList());
    }

    private static List<TaxGroup> groupByTaxRate(List<LineTotals> lines) {
        Map<TaxRate, TaxGroup> groups = new LinkedHashMap<>();
        for (LineTotals line : lines) {
            groups.merge(line.taxRate(), new TaxGroup(line.taxRate(), line.subtotal(), line.tax()), TaxGroup::plus);
        }
        return groups.values().stream().sorted(HIGHEST_RATE_FIRST_EXEMPT_LAST).toList();
    }
}
