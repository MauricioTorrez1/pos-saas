package io.github.mauriciotorrez1.pos.core.sync;

import io.github.mauriciotorrez1.pos.id.Uuid7;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/** Builds valid operations and batches, as the register sends them (see packages/contracts/cases/sync-push.json). */
final class SyncFixtures {

    static final JsonMapper JSON = JsonMapper.builder().build();
    static final String OCCURRED_AT = "2026-12-10T18:21:04.123Z";

    private static final AtomicLong SEQUENCE = new AtomicLong(1);

    private SyncFixtures() {
    }

    /** A batch with the operations, in the order given. */
    static ObjectNode batch(UUID registerId, ObjectNode... operations) {
        ObjectNode batch = JSON.createObjectNode();
        batch.put("registerId", registerId.toString());
        ArrayNode array = batch.putArray("operations");
        for (ObjectNode operation : operations) {
            array.add(operation);
        }
        return batch;
    }

    static ObjectNode operation(UUID opId, String type, ObjectNode payload) {
        ObjectNode operation = JSON.createObjectNode();
        operation.put("opId", opId.toString());
        operation.put("deviceSeq", SEQUENCE.getAndIncrement());
        operation.put("type", type);
        operation.put("schemaVersion", 1);
        operation.put("occurredAt", OCCURRED_AT);
        operation.set("payload", payload);
        return operation;
    }

    /** A sale of one line worth $116.00 with VAT, paid in cash. */
    static ObjectNode sale(UUID opId, UUID saleId, UUID lineId) {
        ObjectNode payload = JSON.createObjectNode();
        payload.put("saleId", saleId.toString());
        payload.put("folio", 87);
        payload.putNull("cashSessionId");
        payload.putNull("cashierId");
        payload.put("completedAt", OCCURRED_AT);
        payload.put("subtotalCents", 10000);
        payload.put("taxCents", 1600);
        payload.put("totalCents", 11600);
        ObjectNode line = payload.putArray("lines").addObject();
        line.put("id", lineId.toString());
        line.put("lineNumber", 1);
        line.put("productId", Uuid7.next().toString());
        line.put("productName", "Cable THW");
        line.put("unit", "meter");
        line.put("quantityMilli", 3000);
        line.put("unitPriceE4", 386667);
        line.put("taxFactor", "rate");
        line.put("taxRateBp", 1600);
        line.put("subtotalCents", 10000);
        line.put("taxCents", 1600);
        line.put("lineTotalCents", 11600);
        ObjectNode payment = payload.putArray("payments").addObject();
        payment.put("id", Uuid7.next().toString());
        payment.put("method", "cash");
        payment.put("amountCents", 11600);
        payment.putNull("reference");
        return operation(opId, "sale.completed", payload);
    }

    static ObjectNode sale(UUID opId) {
        return sale(opId, Uuid7.next(), Uuid7.next());
    }

    /** A partial return of the sale built by {@link #sale}: 1.000 of its 3.000 meters, $38.66 back in cash. */
    static ObjectNode saleReturn(UUID opId, UUID saleId, UUID saleLineId, long quantityMilli, long refundCents) {
        ObjectNode payload = JSON.createObjectNode();
        payload.put("returnId", Uuid7.next().toString());
        payload.put("saleId", saleId.toString());
        payload.put("cashSessionId", Uuid7.next().toString());
        payload.put("requestedBy", Uuid7.next().toString());
        payload.put("authorizedBy", Uuid7.next().toString());
        payload.put("reason", "Wrong size");
        payload.put("totalCents", refundCents);
        ObjectNode line = payload.putArray("lines").addObject();
        line.put("id", Uuid7.next().toString());
        line.put("saleLineId", saleLineId.toString());
        line.put("quantityMilli", quantityMilli);
        line.put("refundCents", refundCents);
        ObjectNode refund = payload.putArray("refunds").addObject();
        refund.put("id", Uuid7.next().toString());
        refund.put("method", "cash");
        refund.put("amountCents", refundCents);
        refund.putNull("reference");
        return operation(opId, "return.registered", payload);
    }

    static ObjectNode cashSessionOpened(UUID opId, UUID sessionId) {
        ObjectNode payload = JSON.createObjectNode();
        payload.put("sessionId", sessionId.toString());
        payload.put("openedBy", Uuid7.next().toString());
        payload.put("openingFloatCents", 50000);
        return operation(opId, "cash_session.opened", payload);
    }

    static ObjectNode cashMovement(UUID opId, UUID sessionId) {
        ObjectNode payload = JSON.createObjectNode();
        payload.put("movementId", Uuid7.next().toString());
        payload.put("sessionId", sessionId.toString());
        payload.put("kind", "out");
        payload.put("amountCents", 20000);
        payload.put("reason", "Partial withdrawal");
        payload.put("recordedBy", Uuid7.next().toString());
        payload.putNull("authorizedBy");
        return operation(opId, "cash_movement.recorded", payload);
    }

    static ObjectNode cashCut(UUID opId, UUID sessionId, UUID cutId, UUID closedBy) {
        ObjectNode payload = JSON.createObjectNode();
        payload.put("sessionId", sessionId.toString());
        payload.put("cutId", cutId.toString());
        payload.put("closedBy", closedBy.toString());
        ObjectNode expected = payload.putObject("expected");
        expected.put("cashCents", 41600);
        expected.put("cardCents", 0);
        expected.put("transferCents", 0);
        ObjectNode counted = payload.putObject("counted");
        counted.put("cashCents", 41500);
        counted.put("cardCents", 0);
        counted.put("transferCents", 0);
        payload.putObject("denominations").put("50000", 0).put("10000", 4).put("100", 15);
        payload.put("reason", "A missing $1.00 in coins");
        return operation(opId, "cash_session.closed", payload);
    }

    static ObjectNode stockAdjusted(UUID opId, UUID movementId, UUID userId) {
        ObjectNode payload = JSON.createObjectNode();
        payload.put("movementId", movementId.toString());
        payload.put("productId", Uuid7.next().toString());
        payload.put("movementType", "waste");
        payload.put("quantityMilli", -2500);
        payload.put("reason", "Damaged roll");
        payload.put("userId", userId.toString());
        return operation(opId, "stock.adjusted", payload);
    }
}
