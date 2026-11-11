package io.github.mauriciotorrez1.pos.core.inventory;

import java.util.List;

/**
 * What the stock of a business is worth.
 *
 * @param totalCents           sum of the value of every product, in cents; each product is rounded before adding
 * @param products             cost and stock of every product that has moved
 * @param productsWithoutCost  how many products have stock movements but no known cost, which are worth zero here
 */
public record InventoryValue(long totalCents, List<ProductCost> products, int productsWithoutCost) {
}
