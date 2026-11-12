package io.github.mauriciotorrez1.pos.core.catalog.web;

import io.github.mauriciotorrez1.pos.core.catalog.ProductCatalog;
import io.github.mauriciotorrez1.pos.core.catalog.ProductPage;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * The report of products that cannot be invoiced yet because a SAT key is missing (RF-004). Who may read it is
 * decided by the permission table (ADR 0042): the owner and the manager.
 */
@RestController
class FiscalPendingController {

    private final ProductCatalog catalog;

    FiscalPendingController(ProductCatalog catalog) {
        this.catalog = catalog;
    }

    /**
     * Lists the live products without a SAT product key or without a SAT unit key, ordered by name.
     *
     * @param page the page number, from 0
     * @param size products per page, from 1 to 100
     * @return the page; each product shows which key is missing through {@code satProductKey} and {@code satUnitKey}
     */
    @GetMapping("/reports/fiscal-pending")
    ProductsController.PageView fiscalPending(@RequestParam(defaultValue = "0") int page,
                                              @RequestParam(defaultValue = "20") int size) {
        ProductPage result = catalog.fiscalPending(page, size);
        return new ProductsController.PageView(result.items().stream().map(ProductsController.ProductView::of).toList(),
                result.page(), result.size(), result.total());
    }
}
