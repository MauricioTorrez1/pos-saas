package io.github.mauriciotorrez1.pos.core.reporting;

import io.github.mauriciotorrez1.pos.id.Uuid7;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * Appends entries to the audit log. The entry is written in the transaction of the change it
 * describes, so both are saved together or neither is. The business comes from the transaction
 * (ADR 0035), so a caller cannot write an entry for another business.
 */
@Service
public class AuditLog {

    private final JdbcTemplate jdbc;

    AuditLog(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * Records a change. It fails if there is no transaction, because an audit entry that could be
     * saved apart from its change could also be lost without it.
     *
     * @param entry what to record
     * @throws org.springframework.transaction.IllegalTransactionStateException if no transaction is active
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public void record(AuditEntry entry) {
        jdbc.update("""
                INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, old_value, new_value)
                VALUES (?, ?, ?, ?, ?, ?::jsonb, ?::jsonb)
                """,
                Uuid7.next(), entry.actorId(), entry.action(), entry.entityType(), entry.entityId(),
                entry.oldValue(), entry.newValue());
    }
}
