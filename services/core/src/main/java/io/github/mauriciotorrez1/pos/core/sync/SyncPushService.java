package io.github.mauriciotorrez1.pos.core.sync;

import io.github.mauriciotorrez1.pos.core.sync.SyncOperationStore.ReceivedOperation;
import io.github.mauriciotorrez1.pos.ingest.OperationRecorder;
import io.github.mauriciotorrez1.pos.ingest.OperationRejectedException;
import io.github.mauriciotorrez1.pos.ingest.RegisterOperation;
import io.github.mauriciotorrez1.pos.tenant.TenantContext;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;

/**
 * Applies the batch that a register uploads, one operation at a time (RF-021, ADR 0046).
 *
 * <p>Each operation runs in its own transaction: it claims its {@code op_id} in {@code sync_operation}
 * (unique per business) and writes its records, and both are saved or lost together. So a batch that
 * fails halfway leaves every earlier operation confirmed and every later one untouched, which is what
 * the per-operation response promises. A business-rule failure sends the operation to quarantine and
 * the batch goes on; an unexpected failure (a database that went away) stops the batch, and what was not
 * confirmed is sent again by the register.
 *
 * <p>The business is the one of the current transaction ({@link TenantContext}); nothing in the body
 * can name another one. {@code deviceSeq} is stored for information and never used to reject.
 */
@Service
public class SyncPushService {

    static final int MAX_OPERATIONS = 100;

    private static final Logger LOG = LoggerFactory.getLogger(SyncPushService.class);
    private static final Pattern UUID_V7 = Pattern.compile("^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$");
    private static final Pattern CONSTRAINT = Pattern.compile("constraint \"([A-Za-z0-9_]+)\"");
    private static final Set<String> ENVELOPE_KEYS = Set.of("$schema", "registerId", "operations");
    private static final int MAX_TYPE_LENGTH = 100;

    private final Map<String, OperationRecorder> recorders = new HashMap<>();
    private final SyncOperationStore store;
    private final OperationSchema schema;
    private final TransactionTemplate transaction;

    SyncPushService(List<OperationRecorder> recorders, SyncOperationStore store, OperationSchema schema,
                    TransactionTemplate transaction) {
        for (OperationRecorder recorder : recorders) {
            for (String type : recorder.types()) {
                if (this.recorders.put(type, recorder) != null) {
                    throw new IllegalStateException("Two recorders handle the operation type " + type);
                }
            }
        }
        this.store = store;
        this.schema = schema;
        this.transaction = transaction;
    }

    /**
     * What the batch produced.
     *
     * @param results one result per operation handled, in the order of the batch
     * @param stopped {@code true} if an unexpected failure ended the batch before its last operation
     */
    public record PushOutcome(List<SyncResult> results, boolean stopped) {
    }

    /**
     * Applies a batch for the business of the current transaction context.
     *
     * @param body the request body, as received
     * @return a result per operation handled; the operations after a stop are not in it
     * @throws InvalidBatchException if the envelope is malformed, in which case nothing is stored
     * @throws IllegalStateException if no business is set for the current thread
     */
    public PushOutcome push(JsonNode body) {
        TenantContext.current().orElseThrow(() -> new IllegalStateException("A push needs the business of the token"));
        JsonNode registerId = checkEnvelope(body);
        List<SyncResult> results = new ArrayList<>();
        for (JsonNode operation : body.get("operations")) {
            try {
                results.add(handle(UUID.fromString(registerId.asString()), registerId, operation));
            } catch (RuntimeException failure) {
                // The register keeps the rest pending and sends it again. The message is not logged: it may hold data.
                LOG.error("Stopped a sync batch after {} operations: {}", results.size(), failure.getClass().getName());
                return new PushOutcome(results, true);
            }
        }
        return new PushOutcome(results, false);
    }

    /** The envelope is what the register must always get right; without it no operation can be named or confirmed. */
    static JsonNode checkEnvelope(JsonNode body) {
        if (body == null || !body.isObject()) {
            throw new InvalidBatchException("The body must be a JSON object");
        }
        body.propertyNames().forEach(key -> {
            if (!ENVELOPE_KEYS.contains(key)) {
                throw new InvalidBatchException("Unexpected field in the body: the business comes from the token, not from the body");
            }
        });
        JsonNode registerId = body.get("registerId");
        if (!isUuidV7(registerId)) {
            throw new InvalidBatchException("registerId must be a UUIDv7");
        }
        JsonNode operations = body.get("operations");
        if (operations == null || !operations.isArray() || operations.isEmpty() || operations.size() > MAX_OPERATIONS) {
            throw new InvalidBatchException("operations must be an array of 1 to " + MAX_OPERATIONS + " operations");
        }
        for (JsonNode operation : operations) {
            if (!operation.isObject() || !isUuidV7(operation.get("opId"))) {
                throw new InvalidBatchException("Every operation must be an object with an opId that is a UUIDv7");
            }
        }
        return registerId;
    }

    private static boolean isUuidV7(JsonNode node) {
        return node != null && node.isString() && UUID_V7.matcher(node.asString()).matches();
    }

    private SyncResult handle(UUID registerUuid, JsonNode registerId, JsonNode operation) {
        UUID opId = UUID.fromString(operation.get("opId").asString());
        ReceivedOperation received = received(opId, registerUuid, operation);
        Optional<String> problem = problemWith(registerId, operation);
        if (problem.isPresent()) {
            return quarantine(received, problem.get());
        }
        OperationRecorder recorder = recorders.get(operation.get("type").asString());
        try {
            // The schema checks the shape of a timestamp, not that the date exists: parsing can still fail.
            RegisterOperation parsed = new RegisterOperation(opId, registerUuid, received.type(),
                    Instant.parse(operation.get("occurredAt").asString()), operation.get("payload"));
            Boolean stored = transaction.execute(status -> {
                if (!store.claim(received)) {
                    return false;
                }
                recorder.record(parsed);
                return true;
            });
            return Boolean.TRUE.equals(stored) ? SyncResult.accepted(opId.toString()) : SyncResult.duplicate(opId.toString());
        } catch (OperationRejectedException rejected) {
            return quarantine(received, rejected.getMessage());
        } catch (DataIntegrityViolationException violation) {
            return quarantine(received, integrityReason(violation));
        } catch (DateTimeParseException invalidDate) {
            return quarantine(received, "A timestamp is not a real date");
        }
    }

    /** The cheap checks first: a type or version the core does not know is kept for review, not rejected (ADR 0040). */
    private Optional<String> problemWith(JsonNode registerId, JsonNode operation) {
        JsonNode type = operation.get("type");
        if (type == null || !type.isString() || !recorders.containsKey(type.asString())) {
            return Optional.of("The core does not know this operation type");
        }
        JsonNode version = operation.get("schemaVersion");
        if (version == null || !version.isIntegralNumber() || version.asInt() != 1) {
            return Optional.of("The core does not know this schemaVersion");
        }
        return schema.problemWith(registerId, operation);
    }

    private SyncResult quarantine(ReceivedOperation received, String reason) {
        Boolean stored = transaction.execute(status -> store.quarantine(received, reason));
        // If the key was stored in the meantime, by a repeat or by a concurrent batch, the first copy stands.
        return Boolean.TRUE.equals(stored)
                ? SyncResult.quarantined(received.opId().toString(), reason)
                : SyncResult.duplicate(received.opId().toString());
    }

    /** Names the constraint that failed, never the values: the message of the driver echoes them. */
    private static String integrityReason(DataIntegrityViolationException violation) {
        Throwable cause = violation.getMostSpecificCause();
        Matcher constraint = CONSTRAINT.matcher(String.valueOf(cause.getMessage()));
        return constraint.find()
                ? "The operation breaks the data rule " + constraint.group(1)
                : "The operation breaks a data rule of the core";
    }

    private static ReceivedOperation received(UUID opId, UUID registerId, JsonNode operation) {
        JsonNode type = operation.get("type");
        String typeText = type != null && type.isString() ? type.asString() : "unknown";
        JsonNode seq = operation.get("deviceSeq");
        JsonNode version = operation.get("schemaVersion");
        return new ReceivedOperation(opId, registerId,
                seq != null && seq.canConvertToLong() && seq.isIntegralNumber() ? seq.longValue() : null,
                typeText.length() > MAX_TYPE_LENGTH ? typeText.substring(0, MAX_TYPE_LENGTH) : typeText,
                version != null && version.canConvertToInt() && version.isIntegralNumber() ? version.intValue() : null,
                occurredAt(operation.get("occurredAt")), operation.toString());
    }

    private static OffsetDateTime occurredAt(JsonNode node) {
        if (node == null || !node.isString()) {
            return null;
        }
        try {
            return OffsetDateTime.ofInstant(Instant.parse(node.asString()), ZoneOffset.UTC);
        } catch (DateTimeParseException e) {
            return null;
        }
    }
}
