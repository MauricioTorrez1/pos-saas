package io.github.mauriciotorrez1.pos.core.catalog;

import io.github.mauriciotorrez1.pos.events.BusinessEvent;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.modulith.events.Externalized;

/**
 * A product was created. It leaves through the outbox with its transaction (ADR 0036), keyed by business.
 * Delivery is at least once, so a consumer deduplicates by {@code eventId}.
 *
 * @param eventId       the UUIDv7 of this event
 * @param tenantId      the business
 * @param schemaVersion the version of this payload, 1
 * @param productId     the product
 * @param name          its name
 * @param status        {@code active} or {@code inactive}
 * @param unit          its base unit
 * @param codes         its codes
 * @param changeSeq     its position in the change feed of the business
 * @param occurredAt    when it happened
 */
@Externalized("pos.catalog.product-created.v1::#{tenantId()}")
public record ProductCreated(UUID eventId, UUID tenantId, int schemaVersion, UUID productId, String name,
                             String status, String unit, List<String> codes, long changeSeq,
                             Instant occurredAt) implements BusinessEvent {
}
