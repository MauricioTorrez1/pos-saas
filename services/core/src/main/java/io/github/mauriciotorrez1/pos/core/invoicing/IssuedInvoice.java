package io.github.mauriciotorrez1.pos.core.invoicing;

/**
 * An invoice as the provider reports it.
 *
 * @param id provider id
 * @param uuid fiscal UUID of the CFDI, or {@code null} until it is stamped
 * @param status provider status, such as {@code valid} or {@code canceled}
 * @param cancellationStatus status of a cancellation request ({@code none}, {@code pending}, {@code accepted},
 *     {@code rejected}), or {@code null}
 * @param totalCents total in cents
 */
public record IssuedInvoice(String id, String uuid, String status, String cancellationStatus, long totalCents) {
}
