package io.github.mauriciotorrez1.pos.core.sales;

import io.github.mauriciotorrez1.pos.core.inventory.internal.StockLedger;

/** Deliberate violation for F0-07: sales reaches into the internals of inventory. Never merge. */
public class SaleService {

    private final StockLedger stockLedger = new StockLedger();
}
