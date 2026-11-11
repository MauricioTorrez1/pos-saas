package io.github.mauriciotorrez1.pos.core.identity;

/** A register of the business already uses this code, which prefixes its folios. */
public class RegisterCodeTakenException extends RuntimeException {

    /**
     * Creates the exception.
     *
     * @param registerCode the code that is taken
     */
    public RegisterCodeTakenException(String registerCode) {
        super("Register code " + registerCode + " is taken");
    }
}
