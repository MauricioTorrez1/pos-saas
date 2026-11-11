package io.github.mauriciotorrez1.pos.core.identity;

import java.util.List;
import java.util.UUID;

/**
 * What a register receives when it enrolls.
 *
 * @param registerId   the id of the new register
 * @param branchId     the branch it belongs to
 * @param registerCode the code of the register
 * @param deviceToken  the secret credential of the device, shown only now
 * @param users        the active users with a PIN, with their PIN hashes
 */
public record Enrollment(UUID registerId, UUID branchId, String registerCode, String deviceToken, List<EnrolledUser> users) {

    @Override
    public String toString() {
        return "Enrollment[registerId=" + registerId + ", branchId=" + branchId + ", registerCode=" + registerCode
                + ", deviceToken=<redacted>, users=" + users.size() + "]";
    }
}
