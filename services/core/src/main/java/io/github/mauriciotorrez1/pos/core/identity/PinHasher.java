package io.github.mauriciotorrez1.pos.core.identity;

import java.util.regex.Pattern;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;

/**
 * Hashes and checks PINs with Argon2id (ADR 0043). The parameters are the minimum configuration of
 * the OWASP Password Storage Cheat Sheet: 19 MiB of memory, 2 iterations and 1 lane. The hash is a
 * PHC string with its own salt (16 random bytes) and parameters, so they can be raised later and old
 * hashes still verify.
 *
 * <p>A PIN of 4 to 8 digits has little entropy: no hash makes it safe against someone who copies the
 * database. The lock after 5 failures protects the online path, and the hash only slows the offline one.
 */
final class PinHasher {

    private static final int SALT_BYTES = 16;
    private static final int HASH_BYTES = 32;
    private static final int PARALLELISM = 1;
    private static final int MEMORY_KIB = 19_456;
    private static final int ITERATIONS = 2;
    private static final Pattern VALID_PIN = Pattern.compile("[0-9]{4,8}");

    private final Argon2PasswordEncoder encoder =
            new Argon2PasswordEncoder(SALT_BYTES, HASH_BYTES, PARALLELISM, MEMORY_KIB, ITERATIONS);

    /**
     * Tells whether a text is an acceptable PIN.
     *
     * @param pin the text to check
     * @return {@code true} for 4 to 8 digits
     */
    static boolean isValid(String pin) {
        return pin != null && VALID_PIN.matcher(pin).matches();
    }

    /**
     * Hashes a PIN with a new random salt.
     *
     * @param pin the PIN, already validated
     * @return the PHC string, such as {@code $argon2id$v=19$m=19456,t=2,p=1$...}
     */
    String hash(String pin) {
        return encoder.encode(pin);
    }

    /**
     * Checks a PIN against a stored hash.
     *
     * @param pin  the PIN to check
     * @param hash the stored PHC string
     * @return {@code true} if the PIN produces that hash
     */
    boolean matches(String pin, String hash) {
        return encoder.matches(pin, hash);
    }
}
