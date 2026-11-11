package io.github.mauriciotorrez1.pos.core.reporting;

/** The provider answered with a client error: the message or the credentials are wrong and a retry will not help. */
public class EmailRejectedException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final int status;

    /**
     * Creates the exception. The answer of the provider is not kept: it may echo the address.
     *
     * @param status the HTTP status of the provider
     */
    public EmailRejectedException(int status) {
        super("The e-mail provider rejected the message with status " + status);
        this.status = status;
    }

    /**
     * Returns the HTTP status.
     *
     * @return the status
     */
    public int status() {
        return status;
    }
}
