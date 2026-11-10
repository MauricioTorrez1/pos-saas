package io.github.mauriciotorrez1.pos.ingest;

/**
 * An operation that is well formed but breaks a business rule of the core, such as a sale whose payments
 * do not add up to its total. The operation is kept in quarantine with this message as its reason, so
 * the message must be safe to show to the owner: no card data, no secrets.
 */
public class OperationRejectedException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    /**
     * Creates the exception.
     *
     * @param reason why the operation cannot be applied, in English, at most 500 characters
     */
    public OperationRejectedException(String reason) {
        super(reason);
    }
}
