package io.github.mauriciotorrez1.pos.core.inventory;

import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * An entry of stock with a cost: a purchase received or an opening balance.
 *
 * @param opId          idempotency key (UUIDv7); entering the same key twice stores one entry
 * @param productId     the product that came in
 * @param source        why the stock entered
 * @param quantityMilli units received, in thousandths, at least 1
 * @param unitCostE6    cost of one unit in millionths of a peso (ADR 0011), zero or more
 * @param occurredAt    when the goods arrived, which may be earlier than now (a late entry)
 * @param createdBy     the user who recorded it, or {@code null} for the system
 */
public record StockReceipt(UUID opId, UUID productId, Source source, long quantityMilli, long unitCostE6,
                           Instant occurredAt, UUID createdBy) {

    /** Why stock entered. */
    public enum Source {
        PURCHASE("purchase"), OPENING_BALANCE("opening_balance");

        private final String code;

        Source(String code) {
            this.code = code;
        }

        String code() {
            return code;
        }
    }

    /** Checks the values the database would also refuse, so the caller gets the error before the transaction. */
    public StockReceipt {
        Objects.requireNonNull(opId, "opId");
        Objects.requireNonNull(productId, "productId");
        Objects.requireNonNull(source, "source");
        Objects.requireNonNull(occurredAt, "occurredAt");
        if (quantityMilli < 1) {
            throw new IllegalArgumentException("quantityMilli must be at least 1");
        }
        if (unitCostE6 < 0) {
            throw new IllegalArgumentException("unitCostE6 must not be negative");
        }
    }
}
