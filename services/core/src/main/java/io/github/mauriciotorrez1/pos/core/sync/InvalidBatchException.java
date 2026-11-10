package io.github.mauriciotorrez1.pos.core.sync;

/** The batch envelope is malformed, so nothing in it can be trusted or confirmed (HTTP 400). */
public class InvalidBatchException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /**
     * Creates the exception.
     *
     * @param detail what is wrong with the envelope, safe to show to the register
     */
    public InvalidBatchException(String detail) {
        super(detail);
    }
}
