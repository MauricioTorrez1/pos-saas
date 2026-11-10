package io.github.mauriciotorrez1.pos.core.sales;

import java.util.List;
import java.util.UUID;

/**
 * A sale received by the core, as other modules may read it. Money is in the scales of ADR 0011.
 *
 * @param id sale id
 * @param folio the ticket number printed by the register
 * @param totalCents total with VAT, in cents
 * @param lines the lines sold, in ticket order
 * @param payments how the sale was paid, the largest payment first
 */
public record SaleView(UUID id, long folio, long totalCents, List<Line> lines, List<Payment> payments) {

    /**
     * One line of a sale.
     *
     * @param id line id
     * @param productName name printed on the ticket
     * @param unit unit of measure: {@code piece}, {@code meter}, {@code kilogram} or {@code liter}
     * @param quantityMilli quantity in thousandths of the unit
     * @param unitPriceE4 unit price in ten-thousandths of a peso, VAT included
     * @param taxFactor {@code rate} or {@code exempt}
     * @param taxRateBasisPoints VAT rate in basis points
     */
    public record Line(UUID id, String productName, String unit, long quantityMilli, long unitPriceE4,
            String taxFactor, int taxRateBasisPoints) {
    }

    /**
     * One payment of a sale.
     *
     * @param method {@code cash}, {@code transfer}, {@code card} or {@code card_manual}
     * @param amountCents amount in cents
     */
    public record Payment(String method, long amountCents) {
    }
}
