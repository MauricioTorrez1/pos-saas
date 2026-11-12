package io.github.mauriciotorrez1.pos.core.catalog;

import io.github.mauriciotorrez1.pos.money.TaxRate;
import io.github.mauriciotorrez1.pos.money.Unit;
import io.github.mauriciotorrez1.pos.money.UnitPrice;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * A product of the catalog with its codes and presentations (the {@code Product} aggregate of the domain).
 * It has no price: prices and taxes arrive with F0-17.
 *
 * @param id            the UUIDv7 made by the core
 * @param name          the name shown to the staff
 * @param status        whether it is sold now
 * @param unit          the base unit; quantities of this product count in it, with 3 decimals
 * @param codes         the barcodes and alternate codes, each unique in the business
 * @param presentations the bulk ways to count it, such as a roll
 * @param deletedAt     when it was logically deleted, or {@code null}
 * @param unitPrice     the price per base unit with VAT included, in ten-thousandths of a peso (ADR 0011)
 * @param tax           the VAT rate of the product: 16%, 8%, 0% or exempt
 * @param satProductKey the SAT {@code c_ClaveProdServ} key, or {@code null} while it is missing
 * @param satUnitKey    the SAT {@code c_ClaveUnidad} key, or {@code null} while it is missing
 * @param createdAt     when it was created
 * @param updatedAt     when it last changed
 */
public record Product(UUID id, String name, ProductStatus status, Unit unit, List<ProductCode> codes,
                      List<Presentation> presentations, Instant deletedAt, UnitPrice unitPrice,
                      TaxRate tax, String satProductKey, String satUnitKey, Instant createdAt, Instant updatedAt) {

    /**
     * Tells what the base unit of the product measures.
     *
     * @return a count, a weight, a length, or a volume
     */
    public MeasurementKind unitKind() {
        return MeasurementKind.of(unit);
    }

    /**
     * Tells whether an invoice can be issued for the product: it needs both SAT keys (RF-004).
     *
     * @return {@code true} if it has a product key and a unit key
     */
    public boolean invoiceable() {
        return satProductKey != null && satUnitKey != null;
    }

    /**
     * Tells whether the product was logically deleted.
     *
     * @return {@code true} if it has a deletion time
     */
    public boolean deleted() {
        return deletedAt != null;
    }
}
