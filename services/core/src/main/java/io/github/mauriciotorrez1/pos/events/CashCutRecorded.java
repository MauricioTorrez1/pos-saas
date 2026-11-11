package io.github.mauriciotorrez1.pos.events;

import java.util.UUID;

/**
 * A cash cut was stored in the core. It is published in the transaction that stores it, so the outbox
 * keeps it until every listener finished (ADR 0036). It carries ids only: whoever needs the amounts
 * reads them, so no personal or financial data sits in the outbox table.
 *
 * @param eventId       unique id of this event (UUIDv7), for idempotent consumers
 * @param tenantId      the business that owns the cut
 * @param cutId         the cut
 * @param sessionId     the cash session the cut closed
 * @param schemaVersion version of this event's shape
 */
public record CashCutRecorded(UUID eventId, UUID tenantId, UUID cutId, UUID sessionId, int schemaVersion)
        implements BusinessEvent {

    /** Current version of the shape. */
    public static final int SCHEMA_VERSION = 1;

    /**
     * Creates the event for a stored cut.
     *
     * @param eventId   unique id of the event
     * @param tenantId  the business
     * @param cutId     the cut
     * @param sessionId the closed session
     * @return the event with the current schema version
     */
    public static CashCutRecorded of(UUID eventId, UUID tenantId, UUID cutId, UUID sessionId) {
        return new CashCutRecorded(eventId, tenantId, cutId, sessionId, SCHEMA_VERSION);
    }
}
