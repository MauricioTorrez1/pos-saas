package io.github.mauriciotorrez1.pos.core.sync;

import io.github.mauriciotorrez1.pos.core.reporting.AuditEntry;
import io.github.mauriciotorrez1.pos.core.reporting.AuditLog;
import io.github.mauriciotorrez1.pos.core.sync.ReviewModels.DiscrepancyItem;
import io.github.mauriciotorrez1.pos.core.sync.ReviewModels.Page;
import io.github.mauriciotorrez1.pos.core.sync.ReviewModels.QuarantineItem;
import io.github.mauriciotorrez1.pos.core.sync.ReviewModels.ResolveRequest;
import io.github.mauriciotorrez1.pos.core.sync.ReviewModels.ResolveResult;
import io.github.mauriciotorrez1.pos.core.sync.ReviewModels.Resolution;
import io.github.mauriciotorrez1.pos.feed.ChangePublisher;
import io.github.mauriciotorrez1.pos.ingest.OperationRejectedException;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * The review of what the core could not apply (RF-022, E1-19, ADR 0055): quarantined operations and price discrepancies.
 * Nothing is lost and nothing is edited. A resolution is a row of {@code review_resolution}, written in the same
 * transaction as its effect, its audit entry and the notice for the register, so none exists without the others. Two
 * people resolving the same item at once take the same advisory lock; the second sees the first one's row, and the
 * {@code UNIQUE} constraint is the last line if the lock were ever skipped.
 *
 * <p>The business is the one of the transaction context (ADR 0035), so every query and every write is limited to it by
 * row-level security.
 */
@Service
class ReviewService {

    static final int DEFAULT_LIMIT = 50;
    static final int MAX_LIMIT = 100;
    static final String QUARANTINE = "quarantine";
    static final String DISCREPANCY = "discrepancy";

    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final UUID NIL = new UUID(0, 0);
    private static final Set<String> STATUSES = Set.of("open", "resolved", "all");
    private static final int MAX_REASON = 500;

    private static final String QUARANTINE_SELECT = """
            SELECT o.id, o.op_id, o.register_id, o.type, o.reason AS quarantine_reason, o.occurred_at, o.received_at,
                   o.status AS arrival_status, o.raw_operation::text AS raw,
                   r.action, r.reason AS resolution_reason, r.resolved_by, r.resolved_at
            FROM sync_operation o
            LEFT JOIN review_resolution r ON r.tenant_id = o.tenant_id AND r.kind = 'quarantine' AND r.subject_id = o.op_id
            WHERE (o.status = 'quarantined' OR r.id IS NOT NULL)
            """;
    private static final String DISCREPANCY_SELECT = """
            SELECT p.seq, p.id, p.product_id, p.register_id, p.previous_unit_price_e4, p.new_unit_price_e4, p.server_price_e4,
                   p.changed_by, p.authorized_by, p.occurred_at, p.received_at,
                   r.action, r.reason AS resolution_reason, r.resolved_by, r.resolved_at
            FROM product_price_change p
            LEFT JOIN review_resolution r ON r.tenant_id = p.tenant_id AND r.kind = 'discrepancy' AND r.subject_id = p.id
            WHERE p.discrepancy
            """;

    private final JdbcTemplate jdbc;
    private final TransactionTemplate transaction;
    private final SyncPushService push;
    private final ChangePublisher publisher;
    private final AuditLog auditLog;

    ReviewService(JdbcTemplate jdbc, TransactionTemplate transaction, SyncPushService push, ChangePublisher publisher,
                  AuditLog auditLog) {
        this.jdbc = jdbc;
        this.transaction = transaction;
        this.push = push;
        this.publisher = publisher;
        this.auditLog = auditLog;
    }

    // ---- reading -------------------------------------------------------------------------------------------------

    /**
     * Lists the quarantined operations, oldest first.
     *
     * @param status {@code open} (default), {@code resolved} or {@code all}
     * @param cursor the {@code nextCursor} of the previous page, or {@code null}
     * @param limit  the page size (1 to 100, default 50)
     * @return the page
     */
    Page<QuarantineItem> quarantine(String status, String cursor, Integer limit) {
        String filter = statusOf(status);
        UUID after = cursor == null || cursor.isEmpty() ? NIL : uuidCursor(cursor);
        int size = sizeOf(limit);
        return transaction.execute(tx -> {
            List<RowWithKey<QuarantineItem>> rows = jdbc.query(QUARANTINE_SELECT + statusClause(filter, "r")
                    + " AND o.id > ? ORDER BY o.id LIMIT ?", (rs, n) -> new RowWithKey<>(rs.getObject("id", UUID.class).toString(),
                    quarantineItem(rs, false)), after, size + 1);
            return pageOf(rows, size);
        });
    }

    /**
     * Shows one quarantined operation with the operation exactly as it arrived.
     *
     * @param opId the idempotency key of the operation
     * @return the item with its operation
     * @throws ReviewProblem 404 if the business has no such quarantined operation
     */
    QuarantineItem quarantineDetail(UUID opId) {
        return transaction.execute(tx -> findQuarantine(opId).orElseThrow(() -> ReviewProblem.notFound("quarantined operation")));
    }

    /**
     * Lists the price discrepancies, oldest first.
     *
     * @param status {@code open} (default), {@code resolved} or {@code all}
     * @param cursor the {@code nextCursor} of the previous page, or {@code null}
     * @param limit  the page size (1 to 100, default 50)
     * @return the page
     */
    Page<DiscrepancyItem> discrepancies(String status, String cursor, Integer limit) {
        String filter = statusOf(status);
        long after = cursor == null || cursor.isEmpty() ? 0 : longCursor(cursor);
        int size = sizeOf(limit);
        return transaction.execute(tx -> {
            List<RowWithKey<DiscrepancyItem>> rows = jdbc.query(DISCREPANCY_SELECT + statusClause(filter, "r")
                    + " AND p.seq > ? ORDER BY p.seq LIMIT ?", (rs, n) -> new RowWithKey<>(String.valueOf(rs.getLong("seq")),
                    discrepancyItem(rs)), after, size + 1);
            return pageOf(rows, size);
        });
    }

    /**
     * Shows one price discrepancy.
     *
     * @param id the change id
     * @return the discrepancy
     * @throws ReviewProblem 404 if the business has no such discrepancy
     */
    DiscrepancyItem discrepancyDetail(UUID id) {
        return transaction.execute(tx -> findDiscrepancy(id).orElseThrow(() -> ReviewProblem.notFound("discrepancy")));
    }

    // ---- resolving -----------------------------------------------------------------------------------------------

    /**
     * Resolves a quarantined operation: apply it as it was, apply it with a corrected payload, or reject it.
     *
     * @param actorId the user who resolves it
     * @param opId    the operation
     * @param request what to do
     * @return the resolution that stands; {@code repeated} when it was already resolved the same way
     * @throws ReviewProblem 400 for a bad request, 404 if it does not exist, 409 if it was resolved another way, 422 if the operation still cannot be applied (nothing changes then)
     */
    ResolveResult resolveQuarantine(UUID actorId, UUID opId, ResolveRequest request) {
        Wanted wanted = validate(request, true);
        return transaction.execute(tx -> {
            lock(QUARANTINE, opId);
            QuarantineItem item = findQuarantine(opId).orElseThrow(() -> ReviewProblem.notFound("quarantined operation"));
            if (item.resolution() != null) {
                return repeatOrConflict(item.resolution(), wanted, existingPayload(QUARANTINE, opId));
            }
            if (!wanted.action().equals("rejected")) {
                applyAgain(item, wanted);
            }
            Resolution resolution = store(QUARANTINE, opId, wanted, actorId);
            finish(QUARANTINE, "quarantined_operation", opId, item.type(), resolution);
            return new ResolveResult(resolution, false);
        });
    }

    /**
     * Resolves a price discrepancy: accept the register's price as the one that stands, or reject it with a reason.
     *
     * @param actorId the user who resolves it
     * @param id      the price change
     * @param request what to do ({@code correct} is not offered: the price change itself is a fact of the register)
     * @return the resolution that stands; {@code repeated} when it was already resolved the same way
     * @throws ReviewProblem 400 for a bad request, 404 if it does not exist, 409 if it was resolved another way
     */
    ResolveResult resolveDiscrepancy(UUID actorId, UUID id, ResolveRequest request) {
        Wanted wanted = validate(request, false);
        return transaction.execute(tx -> {
            lock(DISCREPANCY, id);
            DiscrepancyItem item = findDiscrepancy(id).orElseThrow(() -> ReviewProblem.notFound("discrepancy"));
            if (item.resolution() != null) {
                return repeatOrConflict(item.resolution(), wanted, null);
            }
            Resolution resolution = store(DISCREPANCY, id, wanted, actorId);
            finish(DISCREPANCY, "price_discrepancy", id, "product.price_changed", resolution);
            return new ResolveResult(resolution, false);
        });
    }

    // ---- internals -----------------------------------------------------------------------------------------------

    private record Wanted(String action, String reason, JsonNode correctedPayload) {
    }

    private record RowWithKey<T>(String key, T item) {
    }

    private static Wanted validate(ResolveRequest request, boolean mayCorrect) {
        if (request == null || request.action() == null) {
            throw ReviewProblem.invalid("action is required");
        }
        String action = switch (request.action()) {
            case "accept" -> "accepted";
            case "reject" -> "rejected";
            case "correct" -> {
                if (!mayCorrect) {
                    throw ReviewProblem.invalid("A price discrepancy can only be accepted or rejected");
                }
                yield "corrected";
            }
            default -> throw ReviewProblem.invalid("action must be accept, reject" + (mayCorrect ? " or correct" : ""));
        };
        String reason = request.reason() == null ? null : request.reason().strip();
        if (!action.equals("accepted") && (reason == null || reason.isEmpty() || reason.length() > MAX_REASON)) {
            throw ReviewProblem.invalid("reason is required (1 to " + MAX_REASON + " characters) to reject or correct");
        }
        if (action.equals("corrected") && (request.correctedPayload() == null || !request.correctedPayload().isObject())) {
            throw ReviewProblem.invalid("correctedPayload must be the JSON object to apply instead of the original payload");
        }
        if (!action.equals("corrected") && request.correctedPayload() != null) {
            throw ReviewProblem.invalid("correctedPayload is only for the correct action");
        }
        return new Wanted(action, action.equals("accepted") ? null : reason, request.correctedPayload());
    }

    private void lock(String kind, UUID subject) {
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(current_tenant_id()::text || ':review:' || ? || ':' || ?, 0))::text",
                String.class, kind, subject.toString());
    }

    private ResolveResult repeatOrConflict(Resolution existing, Wanted wanted, JsonNode existingPayload) {
        boolean same = existing.action().equals(wanted.action())
                && (!wanted.action().equals("corrected") || wanted.correctedPayload().equals(existingPayload));
        if (!same) {
            throw ReviewProblem.conflict("It was already resolved as " + existing.action() + " and a resolution is final");
        }
        return new ResolveResult(existing, true);
    }

    /** Applies the operation again with the recorders of E1-17. Whatever fails undoes the whole resolution. */
    private void applyAgain(QuarantineItem item, Wanted wanted) {
        ObjectNode operation = ((ObjectNode) item.operation()).deepCopy();
        if (wanted.action().equals("corrected")) {
            operation.set("payload", wanted.correctedPayload());
        }
        try {
            push.applyReviewed(item.registerId(), operation);
        } catch (OperationRejectedException rejected) {
            throw ReviewProblem.notApplicable(rejected.getMessage());
        } catch (DataIntegrityViolationException violation) {
            throw ReviewProblem.notApplicable("The operation breaks a data rule of the core");
        }
    }

    private Resolution store(String kind, UUID subject, Wanted wanted, UUID actorId) {
        OffsetDateTime resolvedAt = jdbc.queryForObject("""
                INSERT INTO review_resolution (kind, subject_id, action, reason, corrected_payload, resolved_by)
                VALUES (?, ?, ?, ?, ?::jsonb, ?)
                ON CONFLICT (tenant_id, kind, subject_id) DO NOTHING
                RETURNING resolved_at
                """, OffsetDateTime.class, kind, subject, wanted.action(), wanted.reason(),
                wanted.correctedPayload() == null ? null : wanted.correctedPayload().toString(), actorId);
        // The advisory lock makes this unreachable; the constraint refuses a second row if the lock were ever skipped.
        return new Resolution(wanted.action(), wanted.reason(), actorId, resolvedAt.toInstant().toString());
    }

    /** The audit entry and the notice for the register, in the transaction of the resolution. */
    private void finish(String kind, String entityType, UUID subject, String operationType, Resolution resolution) {
        // Ids and the word of the outcome only: the reason is the owner's free text and stays out of the audit log.
        auditLog.record(new AuditEntry(resolution.resolvedBy(), "review.resolved", entityType, subject,
                "{\"status\": \"open\"}", "{\"status\": \"" + resolution.action() + "\"}"));
        ObjectNode notice = JSON.createObjectNode();
        notice.put("kind", kind);
        notice.put("resolution", resolution.action());
        notice.put("operationType", operationType);
        if (resolution.reason() != null) {
            notice.put("reason", resolution.reason());
        }
        notice.put("resolvedAt", resolution.resolvedAt());
        publisher.publish(ChangePublisher.REVIEW_RESOLUTION, subject, notice);
    }

    private JsonNode existingPayload(String kind, UUID subject) {
        String text = jdbc.queryForObject("SELECT corrected_payload::text FROM review_resolution WHERE kind = ? AND subject_id = ?",
                String.class, kind, subject);
        return text == null ? null : JSON.readTree(text);
    }

    private Optional<QuarantineItem> findQuarantine(UUID opId) {
        return jdbc.query(QUARANTINE_SELECT + " AND o.op_id = ?", (rs, n) -> quarantineItem(rs, true), opId).stream().findFirst();
    }

    private Optional<DiscrepancyItem> findDiscrepancy(UUID id) {
        return jdbc.query(DISCREPANCY_SELECT + " AND p.id = ?", (rs, n) -> discrepancyItem(rs), id).stream().findFirst();
    }

    private static QuarantineItem quarantineItem(ResultSet rs, boolean withOperation) throws SQLException {
        Resolution resolution = resolution(rs);
        return new QuarantineItem(rs.getObject("op_id", UUID.class), rs.getObject("register_id", UUID.class), rs.getString("type"),
                rs.getString("quarantine_reason"), instant(rs, "occurred_at"), instant(rs, "received_at"),
                resolution == null ? "open" : resolution.action(), resolution, withOperation ? JSON.readTree(rs.getString("raw")) : null);
    }

    private static DiscrepancyItem discrepancyItem(ResultSet rs) throws SQLException {
        Resolution resolution = resolution(rs);
        return new DiscrepancyItem(rs.getObject("id", UUID.class), rs.getObject("product_id", UUID.class),
                rs.getObject("register_id", UUID.class), rs.getLong("previous_unit_price_e4"), rs.getLong("new_unit_price_e4"),
                rs.getLong("server_price_e4"), rs.getObject("changed_by", UUID.class), rs.getObject("authorized_by", UUID.class),
                instant(rs, "occurred_at"), instant(rs, "received_at"), resolution == null ? "open" : resolution.action(), resolution);
    }

    private static Resolution resolution(ResultSet rs) throws SQLException {
        String action = rs.getString("action");
        return action == null ? null : new Resolution(action, rs.getString("resolution_reason"),
                rs.getObject("resolved_by", UUID.class), instant(rs, "resolved_at"));
    }

    private static String instant(ResultSet rs, String column) throws SQLException {
        OffsetDateTime value = rs.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant().toString();
    }

    private static <T> Page<T> pageOf(List<RowWithKey<T>> rows, int size) {
        boolean more = rows.size() > size;
        List<RowWithKey<T>> shown = more ? rows.subList(0, size) : rows;
        return new Page<>(shown.stream().map(RowWithKey::item).toList(), more ? shown.getLast().key() : null);
    }

    private static String statusOf(String status) {
        String value = status == null || status.isEmpty() ? "open" : status;
        if (!STATUSES.contains(value)) {
            throw ReviewProblem.invalid("status must be open, resolved or all");
        }
        return value;
    }

    private static String statusClause(String status, String alias) {
        return switch (status) {
            case "open" -> " AND " + alias + ".id IS NULL";
            case "resolved" -> " AND " + alias + ".id IS NOT NULL";
            default -> "";
        };
    }

    private static int sizeOf(Integer limit) {
        int size = limit == null ? DEFAULT_LIMIT : limit;
        if (size < 1 || size > MAX_LIMIT) {
            throw ReviewProblem.invalid("limit must be between 1 and " + MAX_LIMIT);
        }
        return size;
    }

    private static UUID uuidCursor(String cursor) {
        try {
            return UUID.fromString(cursor);
        } catch (IllegalArgumentException notAnId) {
            throw ReviewProblem.invalid("cursor must be the nextCursor of an earlier answer");
        }
    }

    private static long longCursor(String cursor) {
        try {
            return Long.parseLong(cursor);
        } catch (NumberFormatException notANumber) {
            throw ReviewProblem.invalid("cursor must be the nextCursor of an earlier answer");
        }
    }

    /** Names the kinds of answer the review gives when it cannot do what was asked. */
    static final class ReviewProblem extends org.springframework.web.ErrorResponseException {

        private static final long serialVersionUID = 1L;

        private ReviewProblem(HttpStatus status, String detail) {
            super(status, org.springframework.http.ProblemDetail.forStatusAndDetail(status, detail), null);
        }

        static ReviewProblem invalid(String detail) {
            return new ReviewProblem(HttpStatus.BAD_REQUEST, detail);
        }

        static ReviewProblem notFound(String what) {
            return new ReviewProblem(HttpStatus.NOT_FOUND, "The " + what + " does not exist");
        }

        static ReviewProblem conflict(String detail) {
            return new ReviewProblem(HttpStatus.CONFLICT, detail);
        }

        static ReviewProblem notApplicable(String detail) {
            return new ReviewProblem(HttpStatus.UNPROCESSABLE_CONTENT, "The operation cannot be applied: " + detail);
        }
    }
}
