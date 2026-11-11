package io.github.mauriciotorrez1.pos.core.invoicing;

import java.util.UUID;

/** The business outcomes of {@link IndividualInvoiceService#issue} that are not a success. Messages hold no fiscal data. */
public final class InvoiceFailures {

    private InvoiceFailures() {
    }

    /** The core has not received a sale with that id (or it belongs to another business). */
    public static class SaleNotFoundException extends RuntimeException {
        /** @param saleId the id asked for */
        public SaleNotFoundException(UUID saleId) {
            super("Sale " + saleId + " was not found");
        }
    }

    /** The sale already has a stamped invoice. */
    public static class SaleAlreadyInvoicedException extends RuntimeException {

        private final transient InvoiceResult existing;

        /** @param existing the invoice that already exists */
        public SaleAlreadyInvoicedException(InvoiceResult existing) {
            super("Sale " + existing.saleId() + " is already invoiced");
            this.existing = existing;
        }

        /** @return the invoice that already exists */
        public InvoiceResult existing() {
            return existing;
        }
    }

    /** Another request is stamping the sale right now. */
    public static class InvoiceInProgressException extends RuntimeException {
        /** @param saleId the sale being invoiced */
        public InvoiceInProgressException(UUID saleId) {
            super("Sale " + saleId + " is being invoiced by another request");
        }
    }

    /** The provider could not stamp the invoice. */
    public static class InvoiceNotIssuedException extends RuntimeException {

        /** Why the invoice was not issued. */
        public enum Reason {
            /** The provider refused the data (4xx); correct it and send again. The state is {@code failed}. */
            PROVIDER_REJECTED,
            /** There is no API key; nothing was sent. The state is {@code failed}. */
            PROVIDER_NOT_CONFIGURED,
            /** The provider did not answer; the invoice may or may not exist. The state stays {@code pending}. */
            OUTCOME_UNKNOWN
        }

        private final Reason reason;
        private final UUID invoiceId;
        private final String providerMessage;

        /**
         * @param reason why it was not issued
         * @param invoiceId the local invoice record
         * @param providerMessage text of the provider for a rejection (may hold fiscal data, never log it), else {@code null}
         */
        public InvoiceNotIssuedException(Reason reason, UUID invoiceId, String providerMessage) {
            super("Invoice " + invoiceId + " was not issued: " + reason);
            this.reason = reason;
            this.invoiceId = invoiceId;
            this.providerMessage = providerMessage;
        }

        /** @return why it was not issued */
        public Reason reason() {
            return reason;
        }

        /** @return the local invoice record */
        public UUID invoiceId() {
            return invoiceId;
        }

        /** @return the provider text of a rejection, possibly {@code null}; show it to the user, never log it */
        public String providerMessage() {
            return providerMessage;
        }
    }
}
