package io.github.mauriciotorrez1.pos.core.identity;

import io.github.mauriciotorrez1.pos.core.reporting.AuditEntry;
import io.github.mauriciotorrez1.pos.core.reporting.AuditLog;
import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Sets and checks PINs on the server (F0-15, RF-009, ADR 0043). Only the Argon2id hash is stored;
 * the PIN and its hash never reach a log or the audit log. Five wrong PINs in a row lock the PIN for
 * five minutes, and the lock lives in the database, so it survives a restart.
 */
@Service
public class PinService {

    /** Consecutive wrong PINs that start the lock. */
    static final int MAX_FAILED_ATTEMPTS = 5;
    /** How long a locked PIN refuses every attempt. */
    static final Duration LOCK_DURATION = Duration.ofMinutes(5);

    private final JdbcTemplate jdbc;
    private final AuditLog auditLog;
    private final Clock clock;
    private final PinHasher hasher = new PinHasher();

    PinService(JdbcTemplate jdbc, AuditLog auditLog, Clock clock) {
        this.jdbc = jdbc;
        this.auditLog = auditLog;
        this.clock = clock;
    }

    /**
     * Sets or replaces the PIN of a user, which also clears any lock. An owner may set anyone's PIN;
     * a manager only the PIN of a cashier or its own.
     *
     * @param actor  who makes the change
     * @param userId the user whose PIN is set
     * @param pin    the new PIN, 4 to 8 digits
     * @throws InvalidPinException   if the PIN is not 4 to 8 digits
     * @throws UserNotFoundException if the user is not an active user of the business
     * @throws NotAllowedException   if the actor may not set that user's PIN
     */
    @Transactional
    public void setPin(AppUser actor, UUID userId, String pin) {
        if (!PinHasher.isValid(pin)) {
            throw new InvalidPinException();
        }
        Role target = jdbc.query("SELECT role FROM app_user WHERE id = ? AND active",
                        (rs, row) -> Role.fromValue(rs.getString("role")).orElseThrow(), userId)
                .stream().findFirst().orElseThrow(() -> new UserNotFoundException(userId));
        if (!mayManagePinOf(actor, userId, target)) {
            throw new NotAllowedException("You may not set the PIN of this user");
        }
        jdbc.update("""
                INSERT INTO user_pin (user_id, pin_hash) VALUES (?, ?)
                ON CONFLICT (user_id) DO UPDATE
                SET pin_hash = EXCLUDED.pin_hash, failed_attempts = 0, locked_until = NULL, updated_at = now()
                """, userId, hasher.hash(pin));
        // The entry names who and for whom; it carries neither the PIN nor its hash.
        auditLog.record(new AuditEntry(actor.id(), "user.pin_set", "app_user", userId, null, null));
    }

    /**
     * Checks a PIN. A wrong PIN counts toward the lock; while the PIN is locked it is not even
     * compared, so a right guess cannot succeed during the lock. A user may check their own PIN;
     * owners and managers may check anyone's, which is how an owner approves something.
     *
     * @param actor  who asks
     * @param userId the user whose PIN is checked
     * @param pin    the PIN to check
     * @return the outcome
     * @throws NotAllowedException if the actor may not check that user's PIN
     */
    @Transactional
    public PinCheck verifyPin(AppUser actor, UUID userId, String pin) {
        if (!actor.id().equals(userId) && actor.role() == Role.CASHIER) {
            throw new NotAllowedException("You may only check your own PIN");
        }
        // The row lock makes concurrent guesses count one by one, so parallel requests cannot beat the limit.
        List<StoredPin> rows = jdbc.query(
                "SELECT pin_hash, failed_attempts, locked_until FROM user_pin WHERE user_id = ? FOR UPDATE",
                (rs, row) -> new StoredPin(rs.getString("pin_hash"), rs.getInt("failed_attempts"),
                        rs.getObject("locked_until", OffsetDateTime.class)),
                userId);
        if (rows.isEmpty()) {
            return new PinCheck.NotSet();
        }
        StoredPin stored = rows.get(0);
        Instant now = clock.instant();
        if (stored.lockedUntil() != null && now.isBefore(stored.lockedUntil().toInstant())) {
            return new PinCheck.Locked(Duration.between(now, stored.lockedUntil().toInstant()));
        }
        if (PinHasher.isValid(pin) && hasher.matches(pin, stored.hash())) {
            if (stored.failedAttempts() > 0 || stored.lockedUntil() != null) {
                jdbc.update("UPDATE user_pin SET failed_attempts = 0, locked_until = NULL, updated_at = now() WHERE user_id = ?", userId);
            }
            return new PinCheck.Valid();
        }
        return registerFailure(actor, userId, stored.failedAttempts() + 1, now);
    }

    private PinCheck registerFailure(AppUser actor, UUID userId, int failures, Instant now) {
        if (failures < MAX_FAILED_ATTEMPTS) {
            jdbc.update("UPDATE user_pin SET failed_attempts = ?, locked_until = NULL, updated_at = now() WHERE user_id = ?", failures, userId);
            return new PinCheck.Invalid(MAX_FAILED_ATTEMPTS - failures);
        }
        Instant lockedUntil = now.plus(LOCK_DURATION);
        jdbc.update("UPDATE user_pin SET failed_attempts = 0, locked_until = ?, updated_at = now() WHERE user_id = ?",
                Timestamp.from(lockedUntil), userId);
        auditLog.record(new AuditEntry(actor.id(), "user.pin_locked", "app_user", userId, null,
                "{\"locked_until\": \"" + lockedUntil + "\"}"));
        return new PinCheck.Locked(LOCK_DURATION);
    }

    private static boolean mayManagePinOf(AppUser actor, UUID userId, Role target) {
        return switch (actor.role()) {
            case OWNER -> true;
            case MANAGER -> actor.id().equals(userId) || target == Role.CASHIER;
            case CASHIER -> false;
        };
    }

    private record StoredPin(String hash, int failedAttempts, OffsetDateTime lockedUntil) {
    }
}
