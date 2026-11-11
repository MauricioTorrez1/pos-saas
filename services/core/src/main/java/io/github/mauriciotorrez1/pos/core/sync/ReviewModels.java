package io.github.mauriciotorrez1.pos.core.sync;

import com.fasterxml.jackson.annotation.JsonInclude;
import java.util.List;
import java.util.UUID;
import tools.jackson.databind.JsonNode;

/** The shapes the review endpoints answer with and accept (E1-19, ADR 0055). Times are ISO-8601 text in UTC. */
final class ReviewModels {

    private ReviewModels() {
    }

    /**
     * How an item was resolved.
     *
     * @param action     {@code accepted}, {@code rejected} or {@code corrected}
     * @param reason     the words of the owner, absent when the item was accepted
     * @param resolvedBy the user who resolved it
     * @param resolvedAt when
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    record Resolution(String action, String reason, UUID resolvedBy, String resolvedAt) {
    }

    /**
     * An operation the core could not apply when it arrived.
     *
     * @param opId       the idempotency key of the operation
     * @param registerId the register that sent it
     * @param type       the operation type as received
     * @param reason     why it was kept apart
     * @param occurredAt when it happened on the register, if it was a real date
     * @param receivedAt when the core received it
     * @param status     {@code open} until someone resolves it, then the action taken
     * @param resolution how it was resolved, absent while open
     * @param operation  the whole operation as received, present only in the detail
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    record QuarantineItem(UUID opId, UUID registerId, String type, String reason, String occurredAt, String receivedAt,
                          String status, Resolution resolution, JsonNode operation) {
    }

    /**
     * A price change whose previous price was not the one the core held (RF-022).
     *
     * @param id                  the change id chosen by the register
     * @param productId           the product
     * @param registerId          the register that sent it
     * @param previousUnitPriceE4 the price the register said it changed from
     * @param newUnitPriceE4      the price the register charges now
     * @param serverPriceE4       the price the core held
     * @param changedBy           who changed it
     * @param authorizedBy        who authorized it
     * @param occurredAt          when it happened on the register
     * @param receivedAt          when the core received it
     * @param status              {@code open} until someone resolves it, then the action taken
     * @param resolution          how it was resolved, absent while open
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    record DiscrepancyItem(UUID id, UUID productId, UUID registerId, long previousUnitPriceE4, long newUnitPriceE4,
                           long serverPriceE4, UUID changedBy, UUID authorizedBy, String occurredAt, String receivedAt,
                           String status, Resolution resolution) {
    }

    /**
     * One page of a list.
     *
     * @param items      the items, oldest first
     * @param nextCursor what to send as {@code cursor} for the next page, absent on the last page
     * @param <T>        the kind of item
     */
    @JsonInclude(JsonInclude.Include.NON_NULL)
    record Page<T>(List<T> items, String nextCursor) {
    }

    /**
     * What the owner asks for.
     *
     * @param action           {@code accept}, {@code reject} or (quarantine only) {@code correct}
     * @param reason           why; required to reject or to correct
     * @param correctedPayload the payload to apply instead of the original; required to correct
     */
    record ResolveRequest(String action, String reason, JsonNode correctedPayload) {
    }

    /**
     * The answer to a resolution.
     *
     * @param resolution the resolution that stands
     * @param repeated   {@code true} when the item was already resolved the same way and nothing changed
     */
    record ResolveResult(Resolution resolution, boolean repeated) {
    }
}
