package io.github.mauriciotorrez1.pos.core.sync;

import io.github.mauriciotorrez1.pos.feed.ChangePublisher;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The feed of changes of a business: writes them when the owner modules publish and reads them when a register
 * pulls. The number of each change comes from {@code sync_change_counter}, whose row lock queues the publishers
 * of one business until the earlier one commits, so numbers appear in commit order and a reader never sees a
 * change with a number higher than another that is still in flight (ADR 0048).
 */
@Repository
class SyncChangeFeed implements ChangePublisher {

    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final int SCHEMA_VERSION = 1;

    private static final String NEXT_SEQ = """
            INSERT INTO sync_change_counter (last_seq) VALUES (1)
            ON CONFLICT (tenant_id) DO UPDATE SET last_seq = sync_change_counter.last_seq + 1
            RETURNING last_seq
            """;
    private static final String INSERT = """
            INSERT INTO sync_change (seq, entity_type, entity_id, deleted, schema_version, payload)
            VALUES (?, ?, ?, ?, ?, ?::jsonb)
            """;
    private static final String PAGE = """
            SELECT seq, entity_type, entity_id, deleted, schema_version, payload::text AS payload, changed_at
            FROM sync_change WHERE tenant_id = current_tenant_id() AND seq > ? ORDER BY seq LIMIT ?
            """;
    private static final String HEAD = "SELECT coalesce(max(last_seq), 0) FROM sync_change_counter WHERE tenant_id = current_tenant_id()";

    private final JdbcTemplate jdbc;

    SyncChangeFeed(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * One change as a register receives it.
     *
     * @param seq           the number of the change in the feed of the business
     * @param entityType    what kind of entity changed
     * @param entityId      the id of the entity
     * @param deleted       whether the entity was removed
     * @param schemaVersion the version of the payload shape
     * @param payload       the whole state after the change, or {@code null} for a deletion
     * @param changedAt     when the change was published
     */
    record Change(long seq, String entityType, UUID entityId, boolean deleted, int schemaVersion, JsonNode payload, Instant changedAt) {
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void publish(String entityType, UUID entityId, JsonNode payload) {
        if (payload == null || !payload.isObject()) {
            throw new IllegalArgumentException("The payload of a change must be a JSON object");
        }
        append(entityType, entityId, false, payload.toString());
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void publishDeletion(String entityType, UUID entityId) {
        append(entityType, entityId, true, null);
    }

    private void append(String entityType, UUID entityId, boolean deleted, String payload) {
        Long seq = jdbc.queryForObject(NEXT_SEQ, Long.class);
        jdbc.update(INSERT, seq, entityType, entityId, deleted, SCHEMA_VERSION, payload);
    }

    /**
     * Reads the changes after a cursor, in order.
     *
     * @param after the last number the register applied; 0 for none
     * @param limit how many to read at most
     * @return up to {@code limit} changes with a number higher than {@code after}, ascending
     */
    @Transactional(readOnly = true, propagation = Propagation.MANDATORY)
    List<Change> after(long after, int limit) {
        return jdbc.query(PAGE, (rs, row) -> {
            String payload = rs.getString("payload");
            return new Change(rs.getLong("seq"), rs.getString("entity_type"), rs.getObject("entity_id", UUID.class),
                    rs.getBoolean("deleted"), rs.getInt("schema_version"), payload == null ? null : JSON.readTree(payload),
                    rs.getTimestamp("changed_at").toInstant());
        }, after, limit);
    }

    /**
     * Returns the number of the latest change of the business, which no cursor of a healthy register exceeds.
     *
     * @return the latest number, or 0 when the business has no changes
     */
    @Transactional(readOnly = true, propagation = Propagation.MANDATORY)
    long head() {
        Long head = jdbc.queryForObject(HEAD, Long.class);
        return head == null ? 0 : head;
    }
}
