package io.github.mauriciotorrez1.pos.money;

/** The range every amount, price, and quantity must stay in, so a value means the same here and in TypeScript. */
final class ValueLimits {

    /** The largest integer that JavaScript represents exactly: 2^53 - 1. */
    static final long MAX_VALUE = 9_007_199_254_740_991L;

    private ValueLimits() {}

    /**
     * Checks that a value is from 0 up to {@link #MAX_VALUE}.
     *
     * @param value the value to check
     * @param description what the value is, for the error message: "a unit price"
     * @throws MoneyException with {@code NEGATIVE_INPUT} or {@code OVERFLOW}
     */
    static void requireWithinLimits(long value, String description) {
        // Negatives wait for returns (E1-15) to decide how they round (ADR 0020).
        if (value < 0) {
            throw new MoneyException(
                    MoneyErrorCode.NEGATIVE_INPUT, "Expected %s to be zero or more, got %d".formatted(description, value));
        }
        if (value > MAX_VALUE) {
            throw new MoneyException(
                    MoneyErrorCode.OVERFLOW, "Expected %s to be at most %d, got %d".formatted(description, MAX_VALUE, value));
        }
    }
}
