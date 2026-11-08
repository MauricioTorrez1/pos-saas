package io.github.mauriciotorrez1.pos.money;

/** Tells why a money or quantity value could not be used. */
public class MoneyException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final MoneyErrorCode code;

    /**
     * Creates the exception.
     *
     * @param code the reason, as the shared cases name it
     * @param message a description for logs, with the rejected value
     */
    public MoneyException(MoneyErrorCode code, String message) {
        super(message);
        this.code = code;
    }

    /**
     * Creates the exception from a lower-level failure.
     *
     * @param code the reason, as the shared cases name it
     * @param message a description for logs, with the rejected value
     * @param cause the failure that revealed the problem
     */
    public MoneyException(MoneyErrorCode code, String message, Throwable cause) {
        super(message, cause);
        this.code = code;
    }

    /**
     * Returns why the value was rejected.
     *
     * @return the reason
     */
    public MoneyErrorCode code() {
        return code;
    }
}
