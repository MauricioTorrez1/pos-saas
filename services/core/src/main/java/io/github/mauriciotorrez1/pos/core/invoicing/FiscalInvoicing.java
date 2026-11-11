package io.github.mauriciotorrez1.pos.core.invoicing;

import java.util.Optional;

/**
 * Port to the CFDI stamping provider. The rest of the core depends on this interface only, so tests
 * can replace it with a fake and the provider can change without touching the invoicing flows.
 *
 * <p>Every method throws a {@link FacturapiException} subtype on failure and never returns {@code null}.
 */
public interface FiscalInvoicing {

    /**
     * Registers the fiscal data of a receiver so later invoices can reference it by id.
     *
     * @param customer legal name, RFC, tax regime and ZIP code of the receiver
     * @return the stored receiver with the provider id
     */
    FiscalCustomer createCustomer(FiscalCustomerData customer);

    /**
     * Stamps a CFDI. It is not retried automatically, because a retry after a lost response could stamp twice;
     * callers must look the invoice up before trying again.
     *
     * @param draft receiver, lines and payment data of the invoice
     * @return the stamped invoice
     */
    IssuedInvoice createInvoice(InvoiceDraft draft);

    /**
     * Fetches an invoice. Safe to retry.
     *
     * @param invoiceId provider id of the invoice
     * @return the current state of the invoice
     */
    IssuedInvoice getInvoice(String invoiceId);

    /**
     * Looks an invoice up by the {@link InvoiceDraft#externalId()} it was stamped with. This is how a stamping
     * with an unknown outcome (timeout, lost response) is resolved before trying again. Safe to retry.
     *
     * @param externalId the reference sent when the invoice was created
     * @return the invoice, or empty if the provider has none with that reference
     */
    Optional<IssuedInvoice> findByExternalId(String externalId);

    /**
     * Requests the cancellation of an invoice before the SAT.
     *
     * @param invoiceId provider id of the invoice
     * @param motive SAT cancellation motive
     * @param substituteInvoiceId provider id of the replacing invoice; required for
     *     {@link CancellationMotive#WITH_RELATED_DOCUMENT}, otherwise {@code null}
     * @return the invoice with its cancellation status, which the SAT may still resolve later
     */
    IssuedInvoice cancelInvoice(String invoiceId, CancellationMotive motive, String substituteInvoiceId);

    /**
     * Downloads the printable representation of an invoice. Safe to retry.
     *
     * @param invoiceId provider id of the invoice
     * @return the PDF bytes
     */
    byte[] downloadPdf(String invoiceId);

    /**
     * Downloads the signed XML of an invoice. Safe to retry.
     *
     * @param invoiceId provider id of the invoice
     * @return the XML bytes
     */
    byte[] downloadXml(String invoiceId);
}
