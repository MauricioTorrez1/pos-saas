package io.github.mauriciotorrez1.pos.core.identity;

import io.github.mauriciotorrez1.pos.core.reporting.AuditEntry;
import io.github.mauriciotorrez1.pos.core.reporting.AuditLog;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import io.github.mauriciotorrez1.pos.tenant.TenantContext;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Enrolls a register once (F0-15, ADR 0043). An owner or manager issues a code of 80 random bits that
 * expires in 15 minutes and works once; the register trades it for a device token. Only SHA-256
 * hashes of the code and of the token are stored, and neither value reaches a log or the audit log.
 */
@Service
public class EnrollmentService {

    /** How long a code can be redeemed after it is issued. */
    static final Duration CODE_TTL = Duration.ofMinutes(15);

    // Crockford's base32 without I, L, O and U: nothing to confuse when someone types the code.
    private static final String ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
    private static final int CODE_LENGTH = 16;
    private static final Pattern REGISTER_CODE = Pattern.compile("[A-Z0-9]{1,10}");
    private static final Pattern NORMALIZED_CODE = Pattern.compile("[0-9A-HJKMNP-TV-Z]{16}");

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final AuditLog auditLog;
    private final Clock clock;
    private final SecureRandom random = new SecureRandom();

    EnrollmentService(JdbcTemplate jdbc, TransactionTemplate transaction, AuditLog auditLog, Clock clock) {
        this.jdbc = jdbc;
        this.transaction = transaction;
        this.auditLog = auditLog;
        this.clock = clock;
    }

    /**
     * Issues a one-time code for a register that does not exist yet. Call it inside the tenant of the caller.
     *
     * @param actor        the owner or manager who issues it
     * @param branchId     the branch the register will belong to
     * @param registerCode the code of the register, which prefixes its folios: 1 to 10 uppercase letters or digits
     * @param registerName the display name of the register
     * @return the code, shown only now, and when it expires
     * @throws InvalidRequestDataException if the register code or name is not valid
     * @throws BranchNotFoundException     if the branch is not in the business
     * @throws RegisterCodeTakenException  if a register already uses that code
     */
    public IssuedEnrollmentCode issue(AppUser actor, UUID branchId, String registerCode, String registerName) {
        if (registerCode == null || !REGISTER_CODE.matcher(registerCode).matches()) {
            throw new InvalidRequestDataException("registerCode must be 1 to 10 uppercase letters or digits");
        }
        if (registerName == null || registerName.isBlank() || registerName.length() > 80) {
            throw new InvalidRequestDataException("registerName must have 1 to 80 characters");
        }
        return transaction.execute(status -> {
            requireBranch(branchId);
            if (registerCodeExists(registerCode)) {
                throw new RegisterCodeTakenException(registerCode);
            }
            String code = newCode();
            UUID id = Uuid7.next();
            Instant expiresAt = clock.instant().plus(CODE_TTL);
            jdbc.update("""
                    INSERT INTO enrollment_code (id, branch_id, register_code, register_name, code_hash, created_by, expires_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """, id, branchId, registerCode, registerName.strip(), sha256(code), actor.id(), Timestamp.from(expiresAt));
            auditLog.record(new AuditEntry(actor.id(), "register.enrollment_code_issued", "enrollment_code", id, null,
                    "{\"branch_id\": \"" + branchId + "\", \"register_code\": \"" + registerCode
                            + "\", \"expires_at\": \"" + expiresAt + "\"}"));
            return new IssuedEnrollmentCode(id, format(code), expiresAt);
        });
    }

    /**
     * Trades a code for a register and its device token. The code is spent by one conditional update,
     * so two requests with the same code cannot both succeed, and an unknown, used or expired code
     * all fail the same way.
     *
     * @param tenantId the business that issued the code
     * @param code     the code as typed, with or without dashes
     * @return the new register, its token (shown only now) and the PIN hashes of the business
     * @throws InvalidEnrollmentCodeException if the code is unknown, used, expired or from another business
     * @throws RegisterCodeTakenException     if a register took the code meanwhile; the code stays unspent
     */
    public Enrollment enroll(UUID tenantId, String code) {
        String normalized = code == null ? "" : code.replace("-", "").replace(" ", "").toUpperCase(Locale.ROOT);
        if (!NORMALIZED_CODE.matcher(normalized).matches()) {
            throw new InvalidEnrollmentCodeException();
        }
        return TenantContext.callAs(tenantId, () -> transaction.execute(status -> redeem(tenantId, normalized)));
    }

    private Enrollment redeem(UUID tenantId, String normalizedCode) {
        List<Pending> spent = jdbc.query("""
                        UPDATE enrollment_code SET redeemed_at = ?
                        WHERE code_hash = ? AND redeemed_at IS NULL AND expires_at > ?
                        RETURNING id, branch_id, register_code, register_name
                        """,
                (rs, row) -> new Pending(rs.getObject("id", UUID.class), rs.getObject("branch_id", UUID.class),
                        rs.getString("register_code"), rs.getString("register_name")),
                Timestamp.from(clock.instant()), sha256(normalizedCode), Timestamp.from(clock.instant()));
        if (spent.isEmpty()) {
            throw new InvalidEnrollmentCodeException();
        }
        Pending pending = spent.get(0);
        UUID registerId = Uuid7.next();
        try {
            jdbc.update("INSERT INTO register (id, tenant_id, branch_id, code, name) VALUES (?, current_tenant_id(), ?, ?, ?)",
                    registerId, pending.branchId(), pending.registerCode(), pending.registerName());
        } catch (DuplicateKeyException e) {
            throw new RegisterCodeTakenException(pending.registerCode());
        }
        jdbc.update("UPDATE enrollment_code SET register_id = ? WHERE id = ?", registerId, pending.id());
        String token = DeviceToken.generate(tenantId, random);
        jdbc.update("INSERT INTO register_device (register_id, token_hash) VALUES (?, ?)", registerId, DeviceToken.hash(token));
        auditLog.record(new AuditEntry(null, "register.enrolled", "register", registerId, null,
                "{\"branch_id\": \"" + pending.branchId() + "\", \"code\": \"" + pending.registerCode() + "\"}"));
        return new Enrollment(registerId, pending.branchId(), pending.registerCode(), token, usersWithPin());
    }

    /** The active users who have a PIN, with the hash the register needs to check PINs without internet. */
    private List<EnrolledUser> usersWithPin() {
        return jdbc.query("""
                SELECT u.id, u.display_name, u.role, p.pin_hash FROM app_user u JOIN user_pin p ON p.user_id = u.id
                WHERE u.active ORDER BY u.display_name, u.id
                """,
                (rs, row) -> new EnrolledUser(rs.getObject("id", UUID.class), rs.getString("display_name"),
                        Role.fromValue(rs.getString("role")).orElseThrow(), rs.getString("pin_hash")));
    }

    private void requireBranch(UUID branchId) {
        Integer found = jdbc.queryForObject("SELECT count(*) FROM branch WHERE id = ?", Integer.class, branchId);
        if (found == null || found == 0) {
            throw new BranchNotFoundException(branchId);
        }
    }

    private boolean registerCodeExists(String registerCode) {
        Integer found = jdbc.queryForObject("SELECT count(*) FROM register WHERE code = ?", Integer.class, registerCode);
        return found != null && found > 0;
    }

    private String newCode() {
        StringBuilder code = new StringBuilder(CODE_LENGTH);
        for (int i = 0; i < CODE_LENGTH; i++) {
            code.append(ALPHABET.charAt(random.nextInt(ALPHABET.length())));
        }
        return code.toString();
    }

    private static String format(String code) {
        return code.substring(0, 4) + "-" + code.substring(4, 8) + "-" + code.substring(8, 12) + "-" + code.substring(12);
    }

    private static String sha256(String value) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required by the Java platform", e);
        }
    }

    private record Pending(UUID id, UUID branchId, String registerCode, String registerName) {
    }
}
