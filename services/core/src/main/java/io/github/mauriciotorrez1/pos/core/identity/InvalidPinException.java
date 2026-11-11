package io.github.mauriciotorrez1.pos.core.identity;

/** The PIN is not 4 to 8 digits. The message never includes the PIN. */
public class InvalidPinException extends RuntimeException {

    /** Creates the exception. */
    public InvalidPinException() {
        super("The PIN must have 4 to 8 digits");
    }
}
