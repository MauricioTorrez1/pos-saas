package io.github.mauriciotorrez1.pos.core.identity;

/**
 * The enrollment code is unknown, already used, expired or from another business. One exception for
 * all four, so the answer does not tell an attacker which codes exist.
 */
public class InvalidEnrollmentCodeException extends RuntimeException {

    /** Creates the exception. */
    public InvalidEnrollmentCodeException() {
        super("The enrollment code is invalid, used or expired");
    }
}
