package io.github.mauriciotorrez1.pos.core.invoicing;

import io.github.mauriciotorrez1.pos.core.invoicing.GlobalInvoiceViews.Summary;
import java.time.LocalDate;

/** The business outcomes of {@link GlobalInvoiceService#issue} that are not a success. Messages hold no fiscal data. */
public final class GlobalInvoiceFailures {

    private GlobalInvoiceFailures() {
    }

    /** The request names an unknown periodicity, has no day, or carries a malformed payment form. */
    public static class InvalidGlobalRequestException extends RuntimeException {

        private final String field;

        /** @param field the field that is wrong */
        public InvalidGlobalRequestException(String field) {
            super("Invalid global invoice request: " + field);
            this.field = field;
        }

        /** @return the field that is wrong */
        public String field() {
            return field;
        }
    }

    /** The period has not ended yet, so more sales may still come into it. */
    public static class PeriodNotClosedException extends RuntimeException {
        /** @param end the last day of the period */
        public PeriodNotClosedException(LocalDate end) {
            super("The period ends on " + end + " and is not closed yet");
        }
    }

    /** Every sale of the period is already invoiced, or there are none. */
    public static class NoSalesToInvoiceException extends RuntimeException {
        /** Creates the exception. */
        public NoSalesToInvoiceException() {
            super("The period has no sales left to invoice");
        }
    }

    /** The period already has a stamped global. */
    public static class GlobalAlreadyIssuedException extends RuntimeException {

        private final transient Summary existing;

        /** @param existing the global that exists */
        public GlobalAlreadyIssuedException(Summary existing) {
            super("The period already has the global invoice " + existing.id());
            this.existing = existing;
        }

        /** @return the global that exists */
        public Summary existing() {
            return existing;
        }
    }

    /** Another request is stamping the global of the period right now. */
    public static class GlobalInProgressException extends RuntimeException {
        /** Creates the exception. */
        public GlobalInProgressException() {
            super("Another request is stamping the global invoice of this period");
        }
    }

    /** The sales of the period changed since the preview the owner confirmed. Nothing was stamped. */
    public static class PreviewStaleException extends RuntimeException {

        private final int expected;
        private final int actual;

        /**
         * @param expected sales the preview showed
         * @param actual sales there are now
         */
        public PreviewStaleException(int expected, int actual) {
            super("The preview showed " + expected + " sales and there are " + actual);
            this.expected = expected;
            this.actual = actual;
        }

        /** @return sales the preview showed */
        public int expected() {
            return expected;
        }

        /** @return sales there are now */
        public int actual() {
            return actual;
        }
    }

    /** The ZIP code of the place of issue is not set, so the generic receiver cannot be built. Nothing was stored. */
    public static class IssuerNotConfiguredException extends RuntimeException {
        /** Creates the exception. */
        public IssuerNotConfiguredException() {
            super("invoicing.issuer-zip-code is not set");
        }
    }
}
