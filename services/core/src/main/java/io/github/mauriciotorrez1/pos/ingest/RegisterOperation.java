package io.github.mauriciotorrez1.pos.ingest;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

/**
 * One operation uploaded by a register, already validated against the shared schema of
 * {@code packages/contracts}. The business is not part of it: it comes from the transaction (ADR 0035).
 *
 * @param opId       the idempotency key chosen by the register (UUIDv7)
 * @param registerId the register that sent it
 * @param type       the operation type, such as {@code sale.completed}
 * @param occurredAt when it happened on the register; informative, never used to order
 * @param payload    the payload of the type, as JSON; read it with {@link Payload}
 */
public record RegisterOperation(UUID opId, UUID registerId, String type, Instant occurredAt, JsonNode payload) {

    /** Checks that every field is present. */
    public RegisterOperation {
        Objects.requireNonNull(opId, "opId");
        Objects.requireNonNull(registerId, "registerId");
        Objects.requireNonNull(type, "type");
        Objects.requireNonNull(occurredAt, "occurredAt");
        Objects.requireNonNull(payload, "payload");
    }
}
