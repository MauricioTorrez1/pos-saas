package io.github.mauriciotorrez1.pos.core.catalog;

import io.github.mauriciotorrez1.pos.money.Unit;
import java.util.List;
import java.util.UUID;

/**
 * What is needed to create a product, already read from the request.
 *
 * @param idempotencyKey the key of the request; repeating it returns the product created the first time
 * @param name           the name
 * @param status         whether it is sold now
 * @param unit           the base unit
 * @param codes          the codes, possibly empty
 * @param presentations  the bulk presentations, possibly empty
 */
public record NewProduct(UUID idempotencyKey, String name, ProductStatus status, Unit unit,
                         List<ProductCode> codes, List<PresentationDraft> presentations) {
}
