package io.github.mauriciotorrez1.pos.core.invoicing;

import java.util.Objects;

/**
 * One line of an invoice, in the scales of ADR 0011.
 *
 * @param description product description
 * @param satProductKey SAT product or service key
 * @param satUnitKey SAT unit key, such as {@code H87} for a piece
 * @param unitName unit name printed on the invoice
 * @param unitPriceE4 unit price in ten-thousandths of a peso, VAT included
 * @param quantityMilli quantity in thousandths of a unit
 * @param taxRateBasisPoints VAT rate in basis points ({@code 1600} is 16%), or {@code null} when the line has no tax
 */
public record InvoiceLineDraft(
        String description,
        String satProductKey,
        String satUnitKey,
        String unitName,
        long unitPriceE4,
        long quantityMilli,
        Integer taxRateBasisPoints) {

    public InvoiceLineDraft {
        Objects.requireNonNull(description, "description");
        Objects.requireNonNull(satProductKey, "satProductKey");
        Objects.requireNonNull(satUnitKey, "satUnitKey");
        Objects.requireNonNull(unitName, "unitName");
        if (unitPriceE4 < 0 || quantityMilli <= 0) {
            throw new IllegalArgumentException("unit price must not be negative and quantity must be positive");
        }
        if (taxRateBasisPoints != null && (taxRateBasisPoints < 0 || taxRateBasisPoints > 10_000)) {
            throw new IllegalArgumentException("tax rate must be between 0 and 10000 basis points");
        }
    }
}
