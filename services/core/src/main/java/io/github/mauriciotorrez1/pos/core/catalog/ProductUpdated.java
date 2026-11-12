package io.github.mauriciotorrez1.pos.core.catalog;

import io.github.mauriciotorrez1.pos.events.BusinessEvent;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.modulith.events.Externalized;

/**
 * A product changed or was logically deleted. It carries the whole state after the change, so a consumer
 * can apply it without reading anything else. Same delivery rules as {@link ProductCreated}.
 *
 * @param eventId       the UUIDv7 of this event
 * @param tenantId      the business
 * @param schemaVersion the version of this payload, 2
 * @param productId     the product
 * @param name          its name after the change
 * @param status        {@code active} or {@code inactive}
 * @param unit          its base unit
 * @param codes         its codes after the change
 * @param deleted       whether the product is now logically deleted
 * @param unitPriceE4   its price with VAT included, in ten-thousandths of a peso
 * @param taxFactor     {@code rate} or {@code exempt}
 * @param taxRateBp     its VAT rate in basis points
 * @param occurredAt    when it happened
 */
@Externalized("pos.catalog.product-updated.v1::#{tenantId()}")
public record ProductUpdated(UUID eventId, UUID tenantId, int schemaVersion, UUID productId, String name,
                             String status, String unit, List<String> codes, boolean deleted,
                             long unitPriceE4, String taxFactor, int taxRateBp, Instant occurredAt) implements BusinessEvent {
}
