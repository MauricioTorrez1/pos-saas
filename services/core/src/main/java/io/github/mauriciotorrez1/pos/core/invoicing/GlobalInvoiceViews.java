package io.github.mauriciotorrez1.pos.core.invoicing;

import java.time.LocalDate;
import java.util.List;
import java.util.UUID;

/** What the global invoice endpoints answer (ADR 0079). Money is in cents. */
public final class GlobalInvoiceViews {

    private GlobalInvoiceViews() {
    }

    /**
     * What a global for a period would hold, before stamping it.
     *
     * @param periodicity {@code daily}, {@code biweekly} or {@code monthly}
     * @param periodStart first day, included
     * @param periodEnd last day, included
     * @param closed whether the period is over; only a closed period can be stamped
     * @param deadline last day to issue it on time (72 hours after the period)
     * @param saleCount sales that would go into it
     * @param totalCents what they add up to, with VAT
     * @param byRate totals per tax rate
     * @param paymentForm the SAT payment form it would carry
     * @param individuallyInvoiced sales of the period left out because they have their own invoice
     * @param existing the live global of the period, if there is one
     * @param sales the sales, oldest first
     */
    public record Preview(String periodicity, LocalDate periodStart, LocalDate periodEnd, boolean closed, LocalDate deadline,
            int saleCount, long totalCents, List<RateTotal> byRate, String paymentForm, long individuallyInvoiced,
            Summary existing, List<SaleRow> sales) {
    }

    /**
     * The totals of one tax rate.
     *
     * @param taxRateBasisPoints VAT rate in basis points, or {@code null} for exempt
     * @param baseCents amount without VAT
     * @param taxCents VAT
     * @param totalCents amount with VAT
     */
    public record RateTotal(Integer taxRateBasisPoints, long baseCents, long taxCents, long totalCents) {
    }

    /**
     * One sale in the preview.
     *
     * @param saleId the sale
     * @param folio ticket number
     * @param day the day it counts on
     * @param totalCents its total, net of returns
     */
    public record SaleRow(UUID saleId, long folio, LocalDate day, long totalCents) {
    }

    /**
     * A global invoice as the panel lists it.
     *
     * @param id local id
     * @param periodicity {@code daily}, {@code biweekly} or {@code monthly}
     * @param periodStart first day
     * @param periodEnd last day
     * @param status {@code pending}, {@code stamped} or {@code failed}
     * @param saleCount sales it holds
     * @param expectedTotalCents what those sales add up to
     * @param totalCents what the provider stamped, once stamped
     * @param fiscalUuid UUID at the SAT, once stamped
     * @param providerInvoiceId id at the provider, to download the PDF and the XML
     * @param errorCode why the last attempt failed, without fiscal data
     * @param overlappingInvoices sales invoiced on their own after this global was stamped; above zero it must be
     *     cancelled with SAT motive 04 and issued again without them
     */
    public record Summary(UUID id, String periodicity, LocalDate periodStart, LocalDate periodEnd, String status,
            int saleCount, long expectedTotalCents, Long totalCents, UUID fiscalUuid, String providerInvoiceId,
            String errorCode, long overlappingInvoices) {
    }
}
