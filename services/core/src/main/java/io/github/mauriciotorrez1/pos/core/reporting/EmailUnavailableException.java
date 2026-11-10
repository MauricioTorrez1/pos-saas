package io.github.mauriciotorrez1.pos.core.reporting;

/** The provider failed (5xx, 429) or could not be reached. The message may or may not have been sent, so the retry reuses its idempotency key. */
public class EmailUnavailableException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /**
     * Creates the exception.
     *
     * @param status the HTTP status, or 0 if there was no answer
     * @param cause  the network failure, or {@code null}
     */
    public EmailUnavailableException(int status, Throwable cause) {
        super(status == 0 ? "The e-mail provider could not be reached" : "The e-mail provider failed with status " + status, cause);
    }
}
