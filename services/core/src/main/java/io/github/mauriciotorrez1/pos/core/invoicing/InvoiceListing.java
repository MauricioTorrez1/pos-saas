package io.github.mauriciotorrez1.pos.core.invoicing;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Reads the individual invoices of the business for the panel (ADR 0081). */
@Component
class InvoiceListing {

    private final JdbcTemplate jdbc;

    InvoiceListing(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * An individual invoice as the panel lists it. The RFC is shown only to owners and managers, who issued it.
     *
     * @param id local id
     * @param saleId the sale
     * @param folio ticket number of the sale
     * @param status {@code pending}, {@code stamped} or {@code failed}
     * @param receiverTaxId RFC of the receiver
     * @param fiscalUuid UUID at the SAT once stamped
     * @param totalCents stamped total
     * @param replacesInvoiceId the invoice it replaces (motive 01), or {@code null}
     * @param superseded whether a cancellation stopped it from covering the sale
     * @param cancellationStatus {@code requested}, {@code pending}, {@code accepted}, {@code rejected}, {@code failed}
     *     or {@code null}
     * @param cancellationMotive SAT motive of the cancellation, or {@code null}
     * @param createdAt when it was asked for
     */
    record InvoiceRow(UUID id, UUID saleId, long folio, String status, String receiverTaxId, UUID fiscalUuid,
            Long totalCents, UUID replacesInvoiceId, boolean superseded, String cancellationStatus,
            String cancellationMotive, Instant createdAt) {
    }

    /**
     * Lists the latest invoices, newest first.
     *
     * @param limit how many
     * @return the invoices
     */
    @Transactional(readOnly = true)
    List<InvoiceRow> recent(int limit) {
        return jdbc.query("""
                SELECT i.id, i.sale_id, s.folio, i.status, i.receiver_tax_id, i.fiscal_uuid, i.total_cents,
                       i.replaces_invoice_id, i.superseded_at IS NOT NULL AS superseded, i.cancellation_status,
                       i.cancellation_motive, i.created_at
                FROM invoice i JOIN sale s ON s.id = i.sale_id
                ORDER BY i.created_at DESC LIMIT ?
                """, (rs, row) -> {
            long total = rs.getLong("total_cents");
            Long stamped = rs.wasNull() ? null : total;
            return new InvoiceRow(rs.getObject("id", UUID.class), rs.getObject("sale_id", UUID.class), rs.getLong("folio"),
                    rs.getString("status"), rs.getString("receiver_tax_id"), rs.getObject("fiscal_uuid", UUID.class), stamped,
                    rs.getObject("replaces_invoice_id", UUID.class), rs.getBoolean("superseded"),
                    rs.getString("cancellation_status"), rs.getString("cancellation_motive"),
                    rs.getTimestamp("created_at").toInstant());
        }, Math.max(1, Math.min(limit, 200)));
    }
}
