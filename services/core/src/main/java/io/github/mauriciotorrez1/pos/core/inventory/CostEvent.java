package io.github.mauriciotorrez1.pos.core.inventory;

import java.time.Instant;
import java.util.Comparator;
import java.util.Objects;
import java.util.UUID;

/**
 * One fact of the stock ledger that matters to the average cost.
 *
 * @param kind          what happened; it also breaks ties between events of the same instant
 * @param at            when it happened in the real world (never when it was received)
 * @param id            id of the source row, the last tie-breaker so the order is total
 * @param productId     the product
 * @param quantityMilli units in thousandths: signed for an adjustment or write-off, and always positive for a
 *                      receipt, a sale (the units sold) and a return (the units given back)
 * @param unitCostE6    cost per unit in millionths of a peso; only for a receipt
 * @param saleLineId    the sale line a sale or a return refers to; otherwise {@code null}
 */
record CostEvent(Kind kind, Instant at, UUID id, UUID productId, long quantityMilli, Long unitCostE6, UUID saleLineId) {

    /** Order of the kinds when two events share an instant: stock arrives before it leaves, a return follows its sale. */
    enum Kind { RECEIPT, SALE, RETURN, ADJUSTMENT }

    /** The replay order: real time, then kind, then id. The same events always give the same order. */
    static final Comparator<CostEvent> REPLAY_ORDER = Comparator
            .comparing(CostEvent::at)
            .thenComparing(CostEvent::kind)
            .thenComparing(CostEvent::id);

    CostEvent {
        Objects.requireNonNull(kind, "kind");
        Objects.requireNonNull(at, "at");
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(productId, "productId");
    }
}
