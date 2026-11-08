import { lineTotals, quantityOf, saleTotals } from '@pos-saas/money';

import type { PendingSale, PendingSaleRequest, SavePendingSaleResult } from '../../shared/pos-api';
import type { ProductCatalog } from '../local-store/product-catalog';
import type { SaleStore } from '../local-store/sale-store';
import { uuidV7 } from '../uuid-v7';
import type { SaleLineToSave, SaleToSave } from './sale-recorder';

/**
 * What the screen can do with a sale that has not been paid: save it before charging, and confirm or cancel it when the
 * register comes back from a power cut (ADR 0010, RF-017).
 */
export class PendingSales {
  readonly #catalog: Pick<ProductCatalog, 'findById'>;
  readonly #sales: SaleStore;

  /**
   * @param catalog where the prices come from
   * @param sales where the sales are saved
   */
  constructor(catalog: Pick<ProductCatalog, 'findById'>, sales: SaleStore) {
    this.#catalog = catalog;
    this.#sales = sales;
  }

  /**
   * Saves a sale as pending, priced with the catalog. Asking again with the same key returns the same sale.
   *
   * @param request the products, the quantities, and the total the customer sees
   * @returns the saved sale, or `catalog_changed` if a product is gone or the total is not the one on the screen
   * @throws MoneyError if a quantity is not valid for its product, or an amount passes the largest supported value
   * @throws Error from SQLite if the key belongs to a sale that was already resolved
   */
  save(request: PendingSaleRequest): SavePendingSaleResult {
    const alreadySaved = this.#sales.findPendingByIdempotencyKey(request.idempotencyKey);
    if (alreadySaved !== null) {
      return { status: 'saved', sale: alreadySaved };
    }
    const sale = this.#price(request);
    if (sale === null) {
      return { status: 'catalog_changed' };
    }
    this.#sales.savePendingPayment(sale);
    return { status: 'saved', sale: this.#sales.findPendingByIdempotencyKey(request.idempotencyKey)! };
  }

  /**
   * Reads the sales waiting to be resolved.
   *
   * @returns the pending sales, oldest first
   */
  list(): PendingSale[] {
    return this.#sales.listPending();
  }

  /**
   * Completes a pending sale that was paid, with a cash payment for its whole total. Cash is the only method the
   * register can take until E1-11.
   *
   * @param saleId the sale
   * @throws SaleNotFoundError if the sale does not exist
   * @throws InvalidSaleTransitionError if the sale is not pending
   */
  confirm(saleId: string): void {
    this.#sales.markCompleted(saleId, { method: 'cash' });
  }

  /**
   * Cancels a pending sale that was not paid.
   *
   * @param saleId the sale
   * @throws SaleNotFoundError if the sale does not exist
   * @throws InvalidSaleTransitionError if the sale is not pending
   */
  cancel(saleId: string): void {
    this.#sales.cancel(saleId);
  }

  #price(request: PendingSaleRequest): SaleToSave | null {
    const lines: SaleLineToSave[] = [];
    for (const { productId, quantityMilli } of request.lines) {
      const product = this.#catalog.findById(productId);
      if (product === null) {
        return null;
      }
      const quantity = quantityOf(quantityMilli, product.unit);
      lines.push({
        id: uuidV7(),
        productId,
        productName: product.name,
        quantity,
        unitPriceE4: product.unitPriceE4,
        totals: lineTotals(product.unitPriceE4, quantity, product.taxRate),
      });
    }
    const { subtotalCents, taxCents, totalCents } = saleTotals(lines.map((line) => line.totals));
    if (totalCents !== request.expectedTotalCents) {
      return null;
    }
    return { saleId: uuidV7(), idempotencyKey: request.idempotencyKey, lines, subtotalCents, taxCents, totalCents };
  }
}
