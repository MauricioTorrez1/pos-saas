package io.github.mauriciotorrez1.pos.core.identity;

import io.github.mauriciotorrez1.pos.core.reporting.AuditEntry;
import io.github.mauriciotorrez1.pos.core.reporting.AuditLog;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Changes the role of a user and leaves the audit entry in the same transaction (RF-040, ADR 0038). */
@Service
public class UserRoleService {

    private final JdbcTemplate jdbc;
    private final AuditLog auditLog;

    UserRoleService(JdbcTemplate jdbc, AuditLog auditLog) {
        this.jdbc = jdbc;
        this.auditLog = auditLog;
    }

    /**
     * Gives a user a new role. Nothing is written when the role does not change.
     *
     * @param actorId the user who makes the change
     * @param userId  the user whose role changes
     * @param newRole the role to give
     * @return the role the user had before
     * @throws UserNotFoundException if the user does not exist in the current business
     * @throws LastOwnerException    if the change would leave the business without an active owner
     */
    @Transactional
    public Role changeRole(UUID actorId, UUID userId, Role newRole) {
        // The row lock serializes two simultaneous changes, so both cannot demote the last two owners.
        Role current = jdbc.query("SELECT role FROM app_user WHERE id = ? FOR UPDATE",
                        (rs, row) -> Role.fromValue(rs.getString("role")).orElseThrow(), userId)
                .stream().findFirst().orElseThrow(() -> new UserNotFoundException(userId));
        if (current == newRole) {
            return current;
        }
        if (current == Role.OWNER && otherActiveOwners(userId) == 0) {
            throw new LastOwnerException();
        }
        jdbc.update("UPDATE app_user SET role = ?, updated_at = now() WHERE id = ?", newRole.value(), userId);
        auditLog.record(new AuditEntry(actorId, "user.role_changed", "app_user", userId,
                "{\"role\": \"" + current.value() + "\"}", "{\"role\": \"" + newRole.value() + "\"}"));
        return current;
    }

    private int otherActiveOwners(UUID userId) {
        Integer count = jdbc.queryForObject(
                "SELECT count(*) FROM app_user WHERE role = 'owner' AND active AND id <> ?", Integer.class, userId);
        return count == null ? 0 : count;
    }
}
