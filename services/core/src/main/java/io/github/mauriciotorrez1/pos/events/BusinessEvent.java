package io.github.mauriciotorrez1.pos.events;

import java.util.UUID;

/**
 * Contract of every event that leaves the core through the outbox (ADR 0005): a unique id so the
 * consumer can be idempotent, the business it belongs to, and the version of its schema.
 */
public interface BusinessEvent {

    /**
     * Returns the unique id of the event (a UUIDv7), the key of consumer idempotency.
     *
     * @return the event id
     */
    UUID eventId();

    /**
     * Returns the business (tenant) the event belongs to.
     *
     * @return the tenant id
     */
    UUID tenantId();

    /**
     * Returns the version of the payload schema, so consumers can tell formats apart.
     *
     * @return the schema version, starting at 1
     */
    int schemaVersion();
}
