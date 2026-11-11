package io.github.mauriciotorrez1.pos.core.catalog;

import io.github.mauriciotorrez1.pos.events.BusinessEvent;
import java.time.Instant;
import java.util.UUID;
import org.springframework.modulith.events.Externalized;

/**
 * The price of a product changed (domain event of docs/plan/02-dominio.md, ADR 0053). It leaves through the
 * outbox in the transaction that stored the change, keyed by business so one business keeps its order. Prices
 * are with VAT included, in ten-thousandths of a peso (ADR 0011).
 *
 * @param eventId             unique id of the event (a UUIDv7), the key of consumer idempotency
 * @param tenantId            the business
 * @param schemaVersion       version of this payload, starting at 1
 * @param changeId            the id of the change given by the register
 * @param productId           the product
 * @param previousUnitPriceE4 the price the register changed from
 * @param newUnitPriceE4      the price it changed to
 * @param changedBy           the person who made the change
 * @param authorizedBy        the owner who approved it
 * @param occurredAt          when the register made the change
 * @param discrepancy         whether the previous price is not the one the core held (RF-022)
 */
@Externalized("pos.catalog.product-price-changed.v1::#{tenantId()}")
public record ProductPriceChanged(UUID eventId, UUID tenantId, int schemaVersion, UUID changeId, UUID productId,
                                  long previousUnitPriceE4, long newUnitPriceE4, UUID changedBy, UUID authorizedBy,
                                  Instant occurredAt, boolean discrepancy) implements BusinessEvent {
}
