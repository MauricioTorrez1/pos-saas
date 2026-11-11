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
 */
public record IssueInvoiceCommand(UUID saleId, Receiver receiver, String paymentForm, Map<UUID, String> satProductKeys,
        UUID actorId) {
}
