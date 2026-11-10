package io.github.mauriciotorrez1.pos.id;

import java.security.SecureRandom;
import java.util.UUID;

/**
 * Generates UUIDv7 identifiers (RFC 9562): 48 bits of Unix time in milliseconds followed by random bits.
 *
 * <p>Ids created later sort after earlier ones, which keeps B-tree indexes compact, unlike random UUIDv4.
 * Java 21 has no built-in generator and PostgreSQL 16 has no {@code uuidv7()}, so the core creates them here.
 */
public final class Uuid7 {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final long VERSION = 7;

    private Uuid7() {
    }

    /**
     * Creates a UUIDv7 for the current instant.
     *
     * @return a new version 7 UUID
     */
    public static UUID next() {
        return of(System.currentTimeMillis(), RANDOM.nextLong(), RANDOM.nextLong());
    }

    /**
     * Builds a UUIDv7 from its parts. Public so tests can fix the clock and the random bits.
     *
     * @param unixMillis milliseconds since the Unix epoch; only the lowest 48 bits are used
     * @param randomHigh random bits that fill the 12-bit {@code rand_a} field
     * @param randomLow  random bits that fill the 62-bit {@code rand_b} field
     * @return a version 7, variant 2 UUID
     */
    public static UUID of(long unixMillis, long randomHigh, long randomLow) {
        long mostSignificant = (unixMillis << 16) | (VERSION << 12) | (randomHigh & 0x0FFFL);
        long leastSignificant = (randomLow & 0x3FFFFFFFFFFFFFFFL) | 0x8000000000000000L;
        return new UUID(mostSignificant, leastSignificant);
    }

    /**
     * Reads the creation time stored in a UUIDv7.
     *
     * @param uuid a version 7 UUID
     * @return milliseconds since the Unix epoch
     * @throws IllegalArgumentException if the UUID is not version 7
     */
    public static long timestampMillis(UUID uuid) {
        if (uuid.version() != VERSION) {
            throw new IllegalArgumentException("Not a UUIDv7: " + uuid);
        }
        return uuid.getMostSignificantBits() >>> 16;
    }
}
