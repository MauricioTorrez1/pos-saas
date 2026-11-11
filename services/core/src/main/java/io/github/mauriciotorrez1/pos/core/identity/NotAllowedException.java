package io.github.mauriciotorrez1.pos.core.identity;

/** The caller holds the permission of the endpoint but may not do this to this user. */
public class NotAllowedException extends RuntimeException {

    /**
     * Creates the exception.
     *
     * @param message why it is not allowed, without secrets
     */
    public NotAllowedException(String message) {
        super(message);
    }
}
