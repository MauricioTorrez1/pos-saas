package io.github.mauriciotorrez1.pos.core.sync;

import io.github.mauriciotorrez1.pos.id.Uuid7;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Keeps the operations that arrived, one row per {@code (tenant, op_id)}. The unique constraint of
 * PostgreSQL is what makes the push idempotent: {@code INSERT ... ON CONFLICT DO NOTHING} stores the
 * operation once even when the same batch arrives twice or at the same time. A second transaction that
 * inserts the same key waits for the first to finish, then sees the conflict (or, if the first rolled
 * back, stores the row itself).
 */
@Repository
class SyncOperationStore {

    private static final String INSERT = """
            INSERT INTO sync_operation (id, op_id, register_id, device_seq, type, schema_version, occurred_at, status, reason, raw_operation)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb)
            ON CONFLICT (tenant_id, op_id) DO NOTHING
            """;

    private final JdbcTemplate jdbc;

    SyncOperationStore(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Claims the key of an operation that is about to be applied. The claim and the records are saved
     * or lost together, because the caller runs both in one transaction.
     *
     * @param received the operation as received
     * @return {@code true} if this call stored the key, {@code false} if it already existed
     */
    @Transactional(propagation = Propagation.MANDATORY)
    boolean claim(ReceivedOperation received) {
        return insert(received, SyncResult.ACCEPTED, null);
    }

    /**
     * Keeps an operation apart for the owner to review.
     *
     * @param received the operation as received
     * @param reason   why it was not applied
     * @return {@code true} if this call stored it, {@code false} if the key already existed
     */
    @Transactional(propagation = Propagation.MANDATORY)
    boolean quarantine(ReceivedOperation received, String reason) {
        return insert(received, SyncResult.QUARANTINED, reason);
    }

    private boolean insert(ReceivedOperation received, String status, String reason) {
        return jdbc.update(INSERT, Uuid7.next(), received.opId(), received.registerId(), received.deviceSeq(),
                received.type(), received.schemaVersion(), received.occurredAt(), status, reason, received.rawJson()) == 1;
    }

    /**
     * The fields of an operation that are kept even when the operation is invalid.
     *
     * @param opId          the idempotency key
     * @param registerId    the register that sent it
     * @param deviceSeq     the sequence number of the register, informative only; may be {@code null}
     * @param type          the operation type as received
     * @param schemaVersion the schema version, or {@code null} when it was not a number
     * @param occurredAt    when it happened, or {@code null} when it was not a timestamp
     * @param rawJson       the whole operation as JSON text
     */
    record ReceivedOperation(UUID opId, UUID registerId, Long deviceSeq, String type, Integer schemaVersion,
                             OffsetDateTime occurredAt, String rawJson) {
    }
}
