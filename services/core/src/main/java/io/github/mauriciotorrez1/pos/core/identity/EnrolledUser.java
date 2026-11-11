package io.github.mauriciotorrez1.pos.core.identity;

import java.util.UUID;

/**
 * A user whose PIN hash a register receives when it enrolls.
 *
 * @param id          the id of the user
 * @param displayName the name shown on the register
 * @param role        the role of the user
 * @param pinHash     the Argon2id hash of the PIN (a PHC string), never the PIN
 */
public record EnrolledUser(UUID id, String displayName, Role role, String pinHash) {

    @Override
    public String toString() {
        return "EnrolledUser[id=" + id + ", role=" + role + ", pinHash=<redacted>]";
    }
}
