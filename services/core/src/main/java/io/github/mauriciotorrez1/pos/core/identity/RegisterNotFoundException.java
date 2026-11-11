package io.github.mauriciotorrez1.pos.core.identity;

import java.util.UUID;

/** The register does not exist, or was never enrolled, in the business of the caller. */
public class RegisterNotFoundException extends RuntimeException {

    /**
     * Creates the exception.
     *
     * @param registerId the id that was not found
     */
    public RegisterNotFoundException(UUID registerId) {
        super("Register " + registerId + " not found");
    }
}
