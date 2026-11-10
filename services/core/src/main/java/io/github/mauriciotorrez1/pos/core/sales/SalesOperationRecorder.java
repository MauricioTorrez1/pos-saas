package io.github.mauriciotorrez1.pos.core.sales;

import io.github.mauriciotorrez1.pos.ingest.OperationRecorder;
import io.github.mauriciotorrez1.pos.ingest.OperationRejectedException;
import io.github.mauriciotorrez1.pos.ingest.Payload;
import io.github.mauriciotorrez1.pos.ingest.RegisterOperation;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;

/**
 * Stores the sales and returns that a register uploads (RF-021, ADR 0046). A completed sale is never
 * edited (ADR 0030): a return is its own record next to the sale. The core checks again what the
 * register already checked, because it cannot trust a client: a sale whose lines or payments do not add
 * up, or a return of more than was sold, goes to quarantine instead of into the books.
 */
@Component
class SalesOperationRecorder implements OperationRecorder {

    private static final String SALE_COMPLETED = "sale.completed";
    private static final String RETURN_REGISTERED = "return.registered";

    private final JdbcTemplate jdbc;

    SalesOperationRecorder(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Set<String> types() {
        return Set.of(SALE_COMPLETED, RETURN_REGISTERED);
    }

    @Override
    @Transactional(propagation = Propagation.MANDATORY)
    public void record(RegisterOperation operation) {
        if (SALE_COMPLETED.equals(operation.type())) {
            recordSale(operation);
        } else {
            recordReturn(operation);
        }
    }

    private void recordSale(RegisterOperation operation) {
        JsonNode sale = operation.payload();
        UUID saleId = Payload.uuid(sale, "saleId");
        checkSaleAddsUp(sale);
        if (exists("SELECT count(*) FROM sale WHERE id = ?", saleId)) {
            throw new OperationRejectedException("The sale was already recorded by another operation");
        }
        jdbc.update("""
                INSERT INTO sale (id, op_id, register_id, folio, cash_session_id, cashier_id, completed_at,
                                  subtotal_cents, tax_cents, total_cents)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                saleId, operation.opId(), operation.registerId(), Payload.number(sale, "folio"),
                Payload.nullableUuid(sale, "cashSessionId"), Payload.nullableUuid(sale, "cashierId"),
                Payload.moment(sale, "completedAt"), Payload.number(sale, "subtotalCents"),
                Payload.number(sale, "taxCents"), Payload.number(sale, "totalCents"));
        for (JsonNode line : sale.get("lines")) {
            jdbc.update("""
                    INSERT INTO sale_line (id, sale_id, line_number, product_id, product_name, unit, quantity_milli,
                                           unit_price_e4, tax_factor, tax_rate_bp, subtotal_cents, tax_cents, line_total_cents)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    Payload.uuid(line, "id"), saleId, Payload.number(line, "lineNumber"), Payload.uuid(line, "productId"),
                    Payload.text(line, "productName"), Payload.text(line, "unit"), Payload.number(line, "quantityMilli"),
                    Payload.number(line, "unitPriceE4"), Payload.text(line, "taxFactor"), (int) Payload.number(line, "taxRateBp"),
                    Payload.number(line, "subtotalCents"), Payload.number(line, "taxCents"), Payload.number(line, "lineTotalCents"));
        }
        for (JsonNode payment : sale.get("payments")) {
            jdbc.update("INSERT INTO sale_payment (id, sale_id, method, amount_cents, reference) VALUES (?, ?, ?, ?, ?)",
                    Payload.uuid(payment, "id"), saleId, Payload.text(payment, "method"),
                    Payload.number(payment, "amountCents"), Payload.nullableText(payment, "reference"));
        }
    }

    /** The totals, the lines and the payments must agree to the cent; a client that sends otherwise is wrong. */
    private static void checkSaleAddsUp(JsonNode sale) {
        long subtotal = 0;
        long tax = 0;
        long total = 0;
        for (JsonNode line : sale.get("lines")) {
            long lineSubtotal = Payload.number(line, "subtotalCents");
            long lineTax = Payload.number(line, "taxCents");
            long lineTotal = Payload.number(line, "lineTotalCents");
            if (lineSubtotal + lineTax != lineTotal) {
                throw new OperationRejectedException("A line does not add up: its base plus its VAT is not its total");
            }
            subtotal += lineSubtotal;
            tax += lineTax;
            total += lineTotal;
        }
        if (subtotal != Payload.number(sale, "subtotalCents") || tax != Payload.number(sale, "taxCents")
                || total != Payload.number(sale, "totalCents")) {
            throw new OperationRejectedException("The lines do not add up to the sale totals");
        }
        if (sumOf(sale.get("payments")) != total) {
            throw new OperationRejectedException("The payments do not add up to the total");
        }
    }

    private void recordReturn(RegisterOperation operation) {
        JsonNode payload = operation.payload();
        UUID returnId = Payload.uuid(payload, "returnId");
        UUID saleId = Payload.uuid(payload, "saleId");
        long total = Payload.number(payload, "totalCents");
        long refunded = 0;
        for (JsonNode line : payload.get("lines")) {
            refunded += Payload.number(line, "refundCents");
        }
        if (refunded != total) {
            throw new OperationRejectedException("The refund of the lines does not add up to the total of the return");
        }
        if (sumOf(payload.get("refunds")) != total) {
            throw new OperationRejectedException("The refunds given back do not add up to the total of the return");
        }
        if (!exists("SELECT count(*) FROM sale WHERE id = ?", saleId)) {
            throw new OperationRejectedException("The return belongs to a sale that the core does not have");
        }
        // Two returns of the same sale must not both pass the check below: they take turns on the sale.
        // A row lock is not possible because sale rows are append-only and the role cannot lock them for update.
        jdbc.queryForObject("SELECT pg_advisory_xact_lock(hashtextextended(?, 0))::text", String.class, saleId.toString());
        if (exists("SELECT count(*) FROM sale_return WHERE id = ?", returnId)) {
            throw new OperationRejectedException("The return was already recorded by another operation");
        }
        jdbc.update("""
                INSERT INTO sale_return (id, op_id, sale_id, cash_session_id, requested_by, authorized_by, reason, total_cents)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                returnId, operation.opId(), saleId, Payload.uuid(payload, "cashSessionId"), Payload.uuid(payload, "requestedBy"),
                Payload.uuid(payload, "authorizedBy"), Payload.text(payload, "reason"), total);
        for (JsonNode line : payload.get("lines")) {
            jdbc.update("INSERT INTO sale_return_line (id, return_id, sale_line_id, quantity_milli, refund_cents) VALUES (?, ?, ?, ?, ?)",
                    Payload.uuid(line, "id"), returnId, Payload.uuid(line, "saleLineId"),
                    Payload.number(line, "quantityMilli"), Payload.number(line, "refundCents"));
            checkNothingReturnedBeyondTheSale(saleId, Payload.uuid(line, "saleLineId"));
        }
        for (JsonNode refund : payload.get("refunds")) {
            jdbc.update("INSERT INTO sale_return_refund (id, return_id, method, amount_cents, reference) VALUES (?, ?, ?, ?, ?)",
                    Payload.uuid(refund, "id"), returnId, Payload.text(refund, "method"),
                    Payload.number(refund, "amountCents"), Payload.nullableText(refund, "reference"));
        }
    }

    /** Nothing is returned beyond what was sold, counting what earlier returns and this one already took. */
    private void checkNothingReturnedBeyondTheSale(UUID saleId, UUID saleLineId) {
        List<Long> available = jdbc.queryForList("""
                SELECT l.quantity_milli - COALESCE((SELECT sum(r.quantity_milli) FROM sale_return_line r
                                                    WHERE r.sale_line_id = l.id), 0)
                FROM sale_line l WHERE l.id = ? AND l.sale_id = ?
                """, Long.class, saleLineId, saleId);
        if (available.isEmpty()) {
            throw new OperationRejectedException("A returned line does not belong to the sale");
        }
        // The line of this return is already inserted, so what is left must not be negative.
        if (available.get(0) < 0) {
            throw new OperationRejectedException("The return takes back more than was sold");
        }
    }

    private static long sumOf(JsonNode flows) {
        long sum = 0;
        for (JsonNode flow : flows) {
            sum += Payload.number(flow, "amountCents");
        }
        return sum;
    }

    private boolean exists(String countQuery, UUID id) {
        Integer count = jdbc.queryForObject(countQuery, Integer.class, id);
        return count != null && count > 0;
    }
}
