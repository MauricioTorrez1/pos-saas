package io.github.mauriciotorrez1.pos.core.invoicing;

import java.util.UUID;

/** The outcomes of a cancellation or a credit note that are not a success (ADR 0081). Messages hold no fiscal data. */
public final class CfdiFailures {

    private CfdiFailures() {
    }

    /** No CFDI of the business has that id. */
    public static class CfdiNotFoundException extends RuntimeException {
        /** @param id the id asked for */
        public CfdiNotFoundException(UUID id) {
            super("CFDI " + id + " was not found");
        }
    }

    /** The request breaks a rule before anything is sent; {@link #code()} says which. */
    public static class InvalidCfdiRequestException extends RuntimeException {

        private final String code;

        /** @param code a short code such as {@code motive_not_allowed} or {@code substitute_required} */
        public InvalidCfdiRequestException(String code) {
            super("Invalid request: " + code);
            this.code = code;
        }

        /** @return the broken rule */
        public String code() {
            return code;
        }
    }

    /** The CFDI is in a state that does not allow the request; {@link #code()} says which. */
    public static class CfdiConflictException extends RuntimeException {

        private final String code;

        /** @param code a short code such as {@code already_cancelled} or {@code in_progress} */
        public CfdiConflictException(String code) {
            super("Conflict: " + code);
            this.code = code;
        }

        /** @return the state that blocks the request */
        public String code() {
            return code;
        }
    }

    /** The provider did not cancel or stamp: it refused, it is not configured, or it did not answer. */
    public static class ProviderNotDoneException extends RuntimeException {

        /** Why. */
        public enum Reason {
            /** The provider refused (4xx); nothing changed. */
            PROVIDER_REJECTED,
            /** There is no API key; nothing was sent. */
            PROVIDER_NOT_CONFIGURED,
            /** No answer; the next request checks the provider before sending again. */
            OUTCOME_UNKNOWN
        }

        private final Reason reason;
        private final String providerMessage;

        /**
         * @param reason why
         * @param providerMessage the provider's refusal text (may hold fiscal data, never log it), or {@code null}
         */
        public ProviderNotDoneException(Reason reason, String providerMessage) {
            super("The provider did not finish: " + reason);
            this.reason = reason;
            this.providerMessage = providerMessage;
        }

        /** @return why */
        public Reason reason() {
            return reason;
        }

        /** @return the provider text of a refusal, possibly {@code null} */
        public String providerMessage() {
            return providerMessage;
        }
    }
}
