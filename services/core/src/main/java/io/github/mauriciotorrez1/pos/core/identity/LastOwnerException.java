package io.github.mauriciotorrez1.pos.core.identity;

/** The change would leave the business without an active owner, so nobody could manage it. */
public class LastOwnerException extends RuntimeException {

    /** Creates the exception. */
    public LastOwnerException() {
        super("A business needs at least one active owner");
    }
}
