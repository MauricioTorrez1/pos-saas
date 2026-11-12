package io.github.mauriciotorrez1.pos.core.catalog;

import io.github.mauriciotorrez1.pos.money.TaxRate;
import io.github.mauriciotorrez1.pos.money.Unit;
import java.util.List;

/**
 * A partial edit of a product: a {@code null} field is left as it is, and a list replaces the whole list.
 *
 * @param name          the new name, or {@code null}
 * @param status        the new status, or {@code null}
 * @param unit          the unit the caller believes the product has, or {@code null}; it must match, because the
 *                      base unit never changes
 * @param codes         the complete new list of codes, or {@code null}
 * @param presentations the complete new list of presentations, or {@code null}
 * @param tax           the new VAT rate, or {@code null}
 * @param satProductKey the new SAT product key, {@code ""} to clear it, or {@code null} to leave it
 * @param satUnitKey    the new SAT unit key, {@code ""} to clear it, or {@code null} to leave it
 */
public record ProductChanges(String name, ProductStatus status, Unit unit, List<ProductCode> codes,
                             List<PresentationDraft> presentations, TaxRate tax, String satProductKey,
                             String satUnitKey) {
}
