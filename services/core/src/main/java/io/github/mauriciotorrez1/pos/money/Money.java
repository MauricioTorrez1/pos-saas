package io.github.mauriciotorrez1.pos.money;

import java.util.Collection;

/**
 * An amount of money in cents: $40.94 is {@code new Money(4094)}. Totals and payments use it (ADR 0011).
 *
 * @param cents the amount in cents
 */
public record Money(long cents) {

    /** No money: the total of a sale with no lines. */
    public static final Money ZERO = new Money(0);

    private static final int DECIMALS = 2;

    /**
     * Checks the amount.
     *
     * @throws MoneyException with {@code NEGATIVE_INPUT} or {@code OVERFLOW}
     */
    public Money {
        ValueLimits.requireWithinLimits(cents, "an amount in cents");
    }

    /**
     * Adds another amount.
     *
     * @param other the amount to add
     * @return the sum
     * @throws MoneyException with {@code OVERFLOW} if the sum exceeds the largest supported value, as in TypeScript
     */
    public Money plus(Money other) {
        // Both are at most 2^53 - 1, so the long cannot overflow before the constructor checks the limit.
        return new Money(cents + other.cents);
    }

    /**
     * Adds amounts, such as the lines of a sale. Each line was already rounded, so the total is an exact sum.
     *
     * @param amounts the amounts to add
     * @return the total, {@link #ZERO} for an empty collection
     * @throws MoneyException with {@code OVERFLOW} if the total exceeds the largest supported value
     */
    public static Money sum(Collection<Money> amounts) {
        Money total = ZERO;
        for (Money amount : amounts) {
            total = total.plus(amount);
        }
        return total;
    }

    /**
     * Reads an amount typed as text, such as the cash a customer hands over: "40.94" is 4094 cents.
     *
     * @param text digits with up to 2 decimals, without a peso sign or commas
     * @return the amount
     * @throws MoneyException with {@code INVALID_FORMAT}, {@code TOO_MANY_DECIMALS}, or {@code OVERFLOW}
     */
    public static Money parse(String text) {
        return new Money(DecimalText.read(text, DECIMALS));
    }
}
