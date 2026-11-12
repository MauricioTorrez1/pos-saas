package io.github.mauriciotorrez1.pos.core.catalog;

import io.github.mauriciotorrez1.pos.money.TaxRate;
import io.github.mauriciotorrez1.pos.money.Unit;
import io.github.mauriciotorrez1.pos.money.UnitPrice;
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
 * @param unitPrice      the price with VAT included, or {@code null} to start at 0 (setting a price is a price change)
 * @param tax            the VAT rate, or {@code null} for 16%
 * @param satProductKey  the SAT product key, or {@code null} while unknown
 * @param satUnitKey     the SAT unit key, or {@code null} while unknown
 */
public record NewProduct(UUID idempotencyKey, String name, ProductStatus status, Unit unit,
                         List<ProductCode> codes, List<PresentationDraft> presentations, UnitPrice unitPrice,
                         TaxRate tax, String satProductKey, String satUnitKey) {
}
