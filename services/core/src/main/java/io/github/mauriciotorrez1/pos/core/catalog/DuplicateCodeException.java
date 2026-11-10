package io.github.mauriciotorrez1.pos.core.catalog;

import java.util.UUID;

/** A code already points at another product of the same business, so it cannot point at a second one. */
public class DuplicateCodeException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final String code;
    private final transient UUID ownerId;

    /**
     * Creates the error.
     *
     * @param code    the code that is taken
     * @param ownerId the product that owns it, or {@code null} if it could not be read
     */
    public DuplicateCodeException(String code, UUID ownerId) {
        super("The code " + code + " already belongs to another product");
        this.code = code;
        this.ownerId = ownerId;
    }

    /**
     * Returns the code that is taken.
     *
     * @return the code
     */
    public String code() {
        return code;
    }

    /**
     * Returns the product that owns the code.
     *
     * @return the owner id, or {@code null}
     */
    public UUID ownerId() {
        return ownerId;
    }
}
