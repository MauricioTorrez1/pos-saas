package io.github.mauriciotorrez1.pos.core.catalog;

import java.util.UUID;

/** The product does not exist in the current business, or was deleted. */
public class ProductNotFoundException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /**
     * Creates the error.
     *
     * @param id the id that was looked up
     */
    public ProductNotFoundException(UUID id) {
        super("No product " + id);
    }
}
