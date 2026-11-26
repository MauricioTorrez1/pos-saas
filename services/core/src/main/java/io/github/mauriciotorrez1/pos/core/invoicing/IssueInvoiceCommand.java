package io.github.mauriciotorrez1.pos.core.invoicing;

import java.util.Map;
import java.util.UUID;

/**
 * What it takes to invoice a sale.
 *
 * @param saleId the sale to invoice
 * @param receiver fiscal data of the customer
 * @param paymentForm SAT payment form; {@code null} to derive it from how the sale was paid
 * @param satProductKeys SAT product key per sale line id, for lines the catalog does not describe yet; may be
 *     {@code null}
 * @param actorId the user who asks for the invoice
 * @param replacesInvoiceId a stamped invoice of the same sale that this one replaces (SAT relation 04), so the
 *     original can then be cancelled with motive 01; {@code null} for a first invoice
 */
public record IssueInvoiceCommand(UUID saleId, Receiver receiver, String paymentForm, Map<UUID, String> satProductKeys,
        UUID actorId, UUID replacesInvoiceId) {

    /** Creates the command of a first invoice. */
    public IssueInvoiceCommand(UUID saleId, Receiver receiver, String paymentForm, Map<UUID, String> satProductKeys,
            UUID actorId) {
        this(saleId, receiver, paymentForm, satProductKeys, actorId, null);
    }
}
