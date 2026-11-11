package io.github.mauriciotorrez1.pos.core.identity;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The device credential of an enrolled register (ADR 0054): {@code <tenantId>.<secret>}, where the
 * secret is 256 random bits. The business travels inside the token because the register has no
 * Keycloak token, and row-level security needs the business before it can find the credential. The
 * business id is not a secret; the secret part is, and only the SHA-256 of the whole token is stored.
 */
public final class DeviceToken {

    private static final int SECRET_BYTES = 32;
    private static final Pattern FORMAT = Pattern.compile(
            "^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\.[A-Za-z0-9_-]{43}$");

    private DeviceToken() {
    }

    /**
     * Creates a credential for a register of a business.
     *
     * @param tenantId the business of the register
     * @param random   the source of randomness
     * @return the token, to show once to the register
     */
    public static String generate(UUID tenantId, SecureRandom random) {
        byte[] secret = new byte[SECRET_BYTES];
        random.nextBytes(secret);
        return tenantId + "." + Base64.getUrlEncoder().withoutPadding().encodeToString(secret);
    }

    /**
     * Reads the business out of a token without checking it. A token that does not have the shape of
     * {@link #generate} gives an empty result.
     *
     * @param token the text received
     * @return the business named by the token
     */
    public static Optional<UUID> tenantOf(String token) {
        if (token == null) {
            return Optional.empty();
        }
        Matcher matcher = FORMAT.matcher(token);
        return matcher.matches() ? Optional.of(UUID.fromString(matcher.group(1))) : Optional.empty();
    }

    /**
     * Hashes a token for storage and lookup.
     *
     * @param token the full token
     * @return the lowercase hexadecimal SHA-256
     */
    public static String hash(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required by the Java platform", e);
        }
    }
}
