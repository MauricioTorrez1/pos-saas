package io.github.mauriciotorrez1.pos.core.invoicing;

/**
 * Facturapi failed or did not answer (5xx, 429, timeout, network). The outcome of a write is unknown: look the
 * invoice up before repeating a stamp.
 */
public class FacturapiUnavailableException extends FacturapiException {

    private final int status;

    /**
     * @param operation name of the failed operation
     * @param status HTTP status, or {@code 0} when there was no response (timeout or network failure)
     * @param cause the underlying failure, if any
     */
    public FacturapiUnavailableException(String operation, int status, Throwable cause) {
        super(operation,
                operation + " failed at Facturapi" + (status > 0 ? " with HTTP " + status : " without a response"),
                cause);
        this.status = status;
    }

    /** @return the HTTP status, or {@code 0} when there was no response */
    public int status() {
        return status;
    }
}
