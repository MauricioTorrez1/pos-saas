package io.github.mauriciotorrez1.pos.core.identity;

import java.util.UUID;

/** The branch does not exist in the business of the caller. */
public class BranchNotFoundException extends RuntimeException {

    /**
     * Creates the exception.
     *
     * @param branchId the id that was not found
     */
    public BranchNotFoundException(UUID branchId) {
        super("Branch " + branchId + " not found");
    }
}
