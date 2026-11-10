package io.github.mauriciotorrez1.pos.core.sync;

import com.fasterxml.jackson.annotation.JsonInclude;

/**
 * What the core did with one operation of a batch, as the register reads it in {@code results}
 * (schema {@code sync-push-response.schema.json}).
 *
 * @param opId   the idempotency key of the operation
 * @param status {@code accepted}, {@code duplicate} or {@code quarantined}
 * @param reason why a quarantined operation was kept apart; absent for the other statuses
 */
@JsonInclude(JsonInclude.Include.NON_NULL)
public record SyncResult(String opId, String status, String reason) {

    /** The operation was stored now. */
    public static final String ACCEPTED = "accepted";

    /** The operation had been stored before with the same opId; nothing changed. */
    public static final String DUPLICATE = "duplicate";

    /** The operation is kept for the owner to review and is never retried. */
    public static final String QUARANTINED = "quarantined";

    /**
     * Builds the result of a stored operation.
     *
     * @param opId the idempotency key
     * @return an {@code accepted} result
     */
    public static SyncResult accepted(String opId) {
        return new SyncResult(opId, ACCEPTED, null);
    }

    /**
     * Builds the result of an operation that was already stored.
     *
     * @param opId the idempotency key
     * @return a {@code duplicate} result
     */
    public static SyncResult duplicate(String opId) {
        return new SyncResult(opId, DUPLICATE, null);
    }

    /**
     * Builds the result of an operation kept for review.
     *
     * @param opId   the idempotency key
     * @param reason why it was not applied
     * @return a {@code quarantined} result
     */
    public static SyncResult quarantined(String opId, String reason) {
        return new SyncResult(opId, QUARANTINED, reason);
    }
}
