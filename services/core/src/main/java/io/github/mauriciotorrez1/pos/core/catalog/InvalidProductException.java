package io.github.mauriciotorrez1.pos.core.catalog;

/** The data of a product breaks a rule of the catalog: the caller can fix it and try again. */
public class InvalidProductException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /**
     * Creates the error.
     *
     * @param message what is wrong, for the person who sent the request
     */
    public InvalidProductException(String message) {
        super(message);
    }
}
