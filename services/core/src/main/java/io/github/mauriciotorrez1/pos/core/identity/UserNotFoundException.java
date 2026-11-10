package io.github.mauriciotorrez1.pos.core.identity;

import java.util.UUID;

/** The user does not exist in the business of the caller. */
public class UserNotFoundException extends RuntimeException {

    /**
     * Creates the exception.
     *
     * @param userId the id that was not found
     */
    public UserNotFoundException(UUID userId) {
        super("User " + userId + " not found");
    }
}
