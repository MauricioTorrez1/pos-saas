package io.github.mauriciotorrez1.pos.core.catalog;

import java.util.List;

/**
 * One page of search results.
 *
 * @param items the products of the page
 * @param page  the page number, starting at 0
 * @param size  the page size asked for
 * @param total how many products match in all pages
 */
public record ProductPage(List<Product> items, int page, int size, long total) {
}
