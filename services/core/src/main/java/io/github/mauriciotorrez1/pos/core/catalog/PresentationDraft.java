package io.github.mauriciotorrez1.pos.core.catalog;

/**
 * A presentation as it arrives in a request: the quantity is still text, because it can only be read once the base
 * unit of the product is known (pieces are whole, meters have three decimals).
 *
 * @param name         what the business calls it, such as {@code roll}
 * @param baseQuantity how much base unit it holds, as text with up to 3 decimals: {@code "100.000"}
 */
public record PresentationDraft(String name, String baseQuantity) {
}
