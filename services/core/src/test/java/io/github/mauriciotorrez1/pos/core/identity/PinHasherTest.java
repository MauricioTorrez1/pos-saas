package io.github.mauriciotorrez1.pos.core.identity;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** PIN hashing: Argon2id with documented parameters, a salt per hash, and the PIN never in the output. */
class PinHasherTest {

    private final PinHasher hasher = new PinHasher();

    @Test
    void theHashIsArgon2idWithTheDocumentedParametersAndHoldsNoPin() {
        String hash = hasher.hash("482915");

        assertThat(hash).startsWith("$argon2id$v=19$m=19456,t=2,p=1$");
        assertThat(hash).doesNotContain("482915");
    }

    @Test
    void theSamePinGetsADifferentHashEveryTimeBecauseOfTheSalt() {
        assertThat(hasher.hash("482915")).isNotEqualTo(hasher.hash("482915"));
    }

    @Test
    void aRightPinMatchesAndAWrongOneDoesNot() {
        String hash = hasher.hash("482915");

        assertThat(hasher.matches("482915", hash)).isTrue();
        assertThat(hasher.matches("482916", hash)).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"1234", "123456", "12345678"})
    void fourToEightDigitsAreValid(String pin) {
        assertThat(PinHasher.isValid(pin)).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "123", "123456789", "12a4", " 1234", "1234 ", "12.34"})
    void anythingElseIsNotAPin(String pin) {
        assertThat(PinHasher.isValid(pin)).isFalse();
    }

    @Test
    void nullIsNotAPin() {
        assertThat(PinHasher.isValid(null)).isFalse();
    }
}
