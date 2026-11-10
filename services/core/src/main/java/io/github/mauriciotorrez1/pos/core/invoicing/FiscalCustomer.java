package io.github.mauriciotorrez1.pos.core.invoicing;

/**
 * A receiver stored at the provider.
 *
 * @param id provider id, used in {@link InvoiceDraft#customerId()}
 */
public record FiscalCustomer(String id) {
}
