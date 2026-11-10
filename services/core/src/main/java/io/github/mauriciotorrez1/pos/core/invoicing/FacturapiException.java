package io.github.mauriciotorrez1.pos.core.invoicing;

/**
 * Base of every failure talking to Facturapi. Messages carry the operation and the HTTP status only, never
 * fiscal data or the API key, so they are safe to log.
 */
public abstract class FacturapiException extends RuntimeException {

    private final String operation;

    protected FacturapiException(String operation, String message, Throwable cause) {
        super(message, cause);
        this.operation = operation;
    }

    /** @return the name of the operation that failed, such as {@code createInvoice} */
    public String operation() {
        return operation;
    }
}
