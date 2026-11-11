package io.github.mauriciotorrez1.pos.core.identity;

/** The data of a request is not valid; the message is safe to show to the caller. */
public class InvalidRequestDataException extends RuntimeException {

    /**
     * Creates the exception.
     *
     * @param message what is wrong, without secrets
     */
    public InvalidRequestDataException(String message) {
        super(message);
    }
}
