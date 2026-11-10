package io.github.mauriciotorrez1.pos.core.cash;

import io.github.mauriciotorrez1.pos.core.reporting.AuditEntry;
import io.github.mauriciotorrez1.pos.core.reporting.AuditLog;
import io.github.mauriciotorrez1.pos.ingest.OperationRecorder;
import io.github.mauriciotorrez1.pos.ingest.OperationRejectedException;
import io.github.mauriciotorrez1.pos.ingest.Payload;
import io.github.mauriciotorrez1.pos.events.CashCutRecorded;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import io.github.mauriciotorrez1.pos.ingest.RegisterOperation;
import io.github.mauriciotorrez1.pos.tenant.TenantContext;
import java.util.Set;
import java.util.UUID;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Stores the cash sessions, cash movements and cuts that a register uploads (RF-021, ADR 0046). A cut
 * closes a session and is sensitive, so it also goes to the audit log in the same transaction, and it
 * publishes {@link CashCutRecorded} so that its report can be sent.
 */
@Component
class CashOperationRecorder implements OperationRecorder {

    private static final String SESSION_OPENED = "cash_session.opened";
    private static final String MOVEMENT_RECORDED = "cash_movement.recorded";
    private static final String SESSION_CLOSED = "cash_session.closed";
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final JdbcTemplate jdbc;
    private final AuditLog auditLog;
    private final ApplicationEventPublisher events;

    CashOperationRecorder(JdbcTemplate jdbc, AuditLog auditLog, ApplicationEventPublisher events) {
        this.jdbc = jdbc;
        this.auditLog = auditLog;
        this.events = events;
    }

    @Override
    public Set<String> types() {
        return Set.of(SESSION_OPENED, MOVEMENT_RECORDED, SESSION_CLOSED);
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void record(RegisterOperation operation) {
        switch (operation.type()) {
            case SESSION_OPENED -> recordOpening(operation);
            case MOVEMENT_RECORDED -> recordMovement(operation);
            default -> recordCut(operation);
        }
    }

    private void recordOpening(RegisterOperation operation) {
        JsonNode payload = operation.payload();
        jdbc.update("""
                INSERT INTO cash_session (id, op_id, register_id, opened_by, opening_float_cents, opened_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                Payload.uuid(payload, "sessionId"), operation.opId(), operation.registerId(),
                Payload.uuid(payload, "openedBy"), Payload.number(payload, "openingFloatCents"),
                Payload.at(operation.occurredAt()));
    }

    private void recordMovement(RegisterOperation operation) {
        JsonNode payload = operation.payload();
        requireSession(Payload.uuid(payload, "sessionId"));
        jdbc.update("""
                INSERT INTO cash_movement (id, op_id, session_id, kind, amount_cents, reason, recorded_by, authorized_by, occurred_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                Payload.uuid(payload, "movementId"), operation.opId(), Payload.uuid(payload, "sessionId"),
                Payload.text(payload, "kind"), Payload.number(payload, "amountCents"), Payload.text(payload, "reason"),
                Payload.uuid(payload, "recordedBy"), Payload.nullableUuid(payload, "authorizedBy"),
                Payload.at(operation.occurredAt()));
    }

    private void recordCut(RegisterOperation operation) {
        JsonNode payload = operation.payload();
        UUID sessionId = Payload.uuid(payload, "sessionId");
        UUID cutId = Payload.uuid(payload, "cutId");
        UUID closedBy = Payload.uuid(payload, "closedBy");
        requireSession(sessionId);
        JsonNode expected = payload.get("expected");
        JsonNode counted = payload.get("counted");
        jdbc.update("""
                INSERT INTO cash_cut (id, op_id, session_id, closed_by, expected_cash_cents, expected_card_cents,
                                      expected_transfer_cents, counted_cash_cents, counted_card_cents,
                                      counted_transfer_cents, denominations, reason, closed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?)
                """,
                cutId, operation.opId(), sessionId, closedBy,
                Payload.number(expected, "cashCents"), Payload.number(expected, "cardCents"), Payload.number(expected, "transferCents"),
                Payload.number(counted, "cashCents"), Payload.number(counted, "cardCents"), Payload.number(counted, "transferCents"),
                payload.get("denominations").toString(), Payload.nullableText(payload, "reason"),
                Payload.at(operation.occurredAt()));
        auditLog.record(new AuditEntry(closedBy, "cash_session.closed", "cash_cut", cutId, null, auditValue(sessionId, expected, counted, payload)));
        // Saved with the cut or not at all: the report of the cut is sent later, by whoever listens (ADR 0052).
        UUID tenant = TenantContext.current().orElseThrow(() -> new IllegalStateException("A cut needs the business of the transaction"));
        events.publishEvent(CashCutRecorded.of(Uuid7.next(), tenant, cutId, sessionId));
    }

    /** Ids and amounts of the cut; the denominations stay in the cut itself. */
    private static String auditValue(UUID sessionId, JsonNode expected, JsonNode counted, JsonNode payload) {
        ObjectNode value = JSON.createObjectNode();
        value.put("sessionId", sessionId.toString());
        value.set("expected", expected);
        value.set("counted", counted);
        String reason = Payload.nullableText(payload, "reason");
        if (reason != null) {
            value.put("reason", reason);
        }
        return value.toString();
    }

    private void requireSession(UUID sessionId) {
        Integer count = jdbc.queryForObject("SELECT count(*) FROM cash_session WHERE id = ?", Integer.class, sessionId);
        if (count == null || count == 0) {
            throw new OperationRejectedException("The cash session is not known to the core");
        }
    }
}
