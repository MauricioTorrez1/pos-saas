package io.github.mauriciotorrez1.pos.core.identity;

import java.time.Instant;
import java.util.UUID;

/**
 * A freshly issued enrollment code. The plain code exists only in this object: the database keeps its hash.
 *
 * @param id        the id of the code record
 * @param code      the code to type on the register, such as {@code 7K2M-XQ4R-9PTA-3VBD}
 * @param expiresAt when the code stops working
 */
public record IssuedEnrollmentCode(UUID id, String code, Instant expiresAt) {

    @Override
    public String toString() {
        return "IssuedEnrollmentCode[id=" + id + ", code=<redacted>, expiresAt=" + expiresAt + "]";
    }
}
