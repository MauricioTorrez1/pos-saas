package io.github.mauriciotorrez1.pos.core.invoicing;

import java.util.List;
import java.util.Objects;

/**
 * Everything the provider needs to stamp a CFDI.
 *
 * @param customerId provider id of the receiver; for a global invoice, the id of the generic public receiver
 * @param lines at least one line
 * @param paymentForm SAT payment form code, such as {@code 01} for cash
 * @param cfdiUse SAT CFDI use code, such as {@code G03}; {@code S01} for a global invoice
 * @param type {@link InvoiceType#INCOME} for a sale, {@link InvoiceType#CREDIT_NOTE} for a return
 * @param globalPeriod set only for a global invoice, otherwise {@code null}
 * @param relatedInvoiceUuids fiscal UUIDs of the invoices a credit note refers to; empty otherwise
 */
public record InvoiceDraft(
        String customerId,
        List<InvoiceLineDraft> lines,
        String paymentForm,
        String cfdiUse,
        InvoiceType type,
        GlobalPeriod globalPeriod,
        List<String> relatedInvoiceUuids) {

    public InvoiceDraft {
        Objects.requireNonNull(customerId, "customerId");
        Objects.requireNonNull(paymentForm, "paymentForm");
        Objects.requireNonNull(cfdiUse, "cfdiUse");
        Objects.requireNonNull(type, "type");
        lines = List.copyOf(Objects.requireNonNull(lines, "lines"));
        relatedInvoiceUuids = relatedInvoiceUuids == null ? List.of() : List.copyOf(relatedInvoiceUuids);
        if (lines.isEmpty()) {
            throw new IllegalArgumentException("an invoice needs at least one line");
        }
    }
}
