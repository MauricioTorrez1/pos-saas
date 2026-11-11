package io.github.mauriciotorrez1.pos.core.invoicing;

import java.util.UUID;

/**
 * A stamped invoice. The PDF and the XML are not stored by the core: download them from the provider with
 * {@code providerInvoiceId} ({@link FiscalInvoicing#downloadPdf}, {@link FiscalInvoicing#downloadXml}).
 *
 * @param invoiceId local id
 * @param saleId the invoiced sale
 * @param status always {@code stamped} for a result
 * @param fiscalUuid UUID of the CFDI at the SAT
 * @param providerInvoiceId id at the provider
 * @param totalCents total of the CFDI in cents
 */
public record InvoiceResult(UUID invoiceId, UUID saleId, String status, UUID fiscalUuid, String providerInvoiceId,
        long totalCents) {
}
