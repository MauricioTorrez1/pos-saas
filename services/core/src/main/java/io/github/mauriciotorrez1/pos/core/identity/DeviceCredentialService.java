package io.github.mauriciotorrez1.pos.core.identity;

import io.github.mauriciotorrez1.pos.core.reporting.AuditEntry;
import io.github.mauriciotorrez1.pos.core.reporting.AuditLog;
import io.github.mauriciotorrez1.pos.tenant.TenantContext;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Authenticates enrolled registers by their device credential and revokes them (E1-41, ADR 0054).
 * Revoking is how a lost or replaced register stops sending: its credential stops working at once.
 */
@Service
public class DeviceCredentialService {

    private static final Logger LOG = LoggerFactory.getLogger(DeviceCredentialService.class);

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final AuditLog auditLog;

    DeviceCredentialService(JdbcTemplate jdbc, TransactionTemplate transaction, AuditLog auditLog) {
        this.jdbc = jdbc;
        this.transaction = transaction;
        this.auditLog = auditLog;
    }

    /**
     * Finds the register of a credential. The business comes from the token and the lookup runs inside
     * it, so a credential can never match a register of another business. Unknown, malformed and
     * revoked credentials all give the same empty answer.
     *
     * @param token the full credential, as received
     * @return the register, or empty if the credential is not valid
     */
    public Optional<DeviceIdentity> authenticate(String token) {
        Optional<UUID> tenant = DeviceToken.tenantOf(token);
        if (tenant.isEmpty()) {
            return Optional.empty();
        }
        String hash = DeviceToken.hash(token);
        return TenantContext.callAs(tenant.get(), () -> transaction.execute(status -> jdbc.query("""
                        SELECT register_id FROM register_device WHERE token_hash = ? AND revoked_at IS NULL
                        """,
                (rs, row) -> new DeviceIdentity(rs.getObject("register_id", UUID.class), tenant.get()),
                hash).stream().findFirst()));
    }

    /**
     * Revokes the credential of a register. Revoking twice changes nothing. Call it inside the tenant of the caller.
     *
     * @param actor      the owner or manager who revokes it
     * @param registerId the register to stop
     * @throws RegisterNotFoundException if the register was never enrolled in this business
     */
    @Transactional
    public void revoke(AppUser actor, UUID registerId) {
        boolean enrolled = !jdbc.queryForList("SELECT 1 FROM register_device WHERE register_id = ?", registerId).isEmpty();
        if (!enrolled) {
            throw new RegisterNotFoundException(registerId);
        }
        int changed = jdbc.update("UPDATE register_device SET revoked_at = now(), revoked_by = ? WHERE register_id = ? AND revoked_at IS NULL",
                actor.id(), registerId);
        if (changed > 0) {
            auditLog.record(new AuditEntry(actor.id(), "register.revoked", "register", registerId, null, null));
        }
    }

    /**
     * Records that a register tried to send a batch that names another register. The entry holds ids only.
     * It never throws: a failure to audit must not change the answer.
     *
     * @param device  the register that authenticated
     * @param claimed the register the batch named
     */
    public void recordRegisterMismatch(DeviceIdentity device, UUID claimed) {
        try {
            TenantContext.runAs(device.tenantId(), () -> transaction.executeWithoutResult(status -> auditLog.record(new AuditEntry(
                    null, "sync.register_mismatch", "register", device.registerId(), null,
                    "{\"claimed_register_id\": \"" + claimed + "\"}"))));
        } catch (RuntimeException e) {
            LOG.error("Could not audit a register mismatch of register {}", device.registerId(), e);
        }
    }
}
