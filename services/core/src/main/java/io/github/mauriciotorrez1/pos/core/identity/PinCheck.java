package io.github.mauriciotorrez1.pos.core.identity;

import java.time.Duration;

/** The outcome of checking a PIN. */
public sealed interface PinCheck {

    /** The PIN is right; the failure count went back to zero. */
    record Valid() implements PinCheck {
    }

    /**
     * The PIN is wrong.
     *
     * @param attemptsLeft how many more wrong PINs are allowed before the lock
     */
    record Invalid(int attemptsLeft) implements PinCheck {
    }

    /**
     * The PIN is locked after too many failures. It is not checked at all until the lock ends.
     *
     * @param retryAfter how long until the next attempt is accepted
     */
    record Locked(Duration retryAfter) implements PinCheck {
    }

    /** The user has no PIN yet. */
    record NotSet() implements PinCheck {
    }
}
