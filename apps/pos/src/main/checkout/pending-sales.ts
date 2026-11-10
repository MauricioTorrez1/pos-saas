import { lineTotals, quantityOf, saleTotals, taxRateOf } from '@pos-saas/money';

import { MISC_PRODUCT_ID, MISC_TAX_RATE_BP } from '../../shared/miscellaneous';
import type { PendingSale, PendingSaleRequest, SavePendingSaleResult } from '../../shared/pos-api';
import type { AuditLog } from '../audit/audit-log';
import type { AuthService } from '../auth/auth-service';
import type { ProductCatalog } from '../local-store/product-catalog';
import type { SaleStore } from '../local-store/sale-store';
import type { PriceHistoryReader } from '../pricing/price-change-service';
import { uuidV7 } from '../uuid-v7';
import type { SaleLineToSave, SaleToSave } from './sale-recorder';

/** Who sells, and in which cash session, so the cut can count the sale. */
export interface SaleContext {
  readonly cashierId: string;
  readonly cashSessionId: string;
}

/**
 * What the screen can do with a sale that has not been paid: save it before charging, and confirm or cancel it when the
 * register comes back from a power cut (ADR 0010, RF-017).
 */
export class PendingSales {
  readonly #catalog: Pick<ProductCatalog, 'findById'>;
  readonly #sales: SaleStore;
  readonly #context: () => SaleContext | null;
  readonly #misc: MiscSupport | null;
  readonly #priceHistory: PriceHistoryReader | null;

  /**
   * @param catalog where the prices come from
   * @param sales where the sales are saved
   * @param context who is selling and in which cash session, or null while the register is closed
   * @param misc who may sell a miscellaneous item and where it is written down. Without it, such a line is refused.
   * @param priceHistory the price a product had before its latest change, so a sale that was being rung up when the owner
   * changed a price keeps the price its lines show (ADR 0047). Without it, the catalog price is the only one honored.
   */
  constructor(
    catalog: Pick<ProductCatalog, 'findById'>,
    sales: SaleStore,
    context: () => SaleContext | null,
    misc: MiscSupport | null = null,
    priceHistory: PriceHistoryReader | null = null,
  ) {
    this.#catalog = catalog;
    this.#sales = sales;
    this.#context = context;
    this.#misc = misc;
    this.#priceHistory = priceHistory;
  }

  /**
   * Saves a sale as pending, priced with the catalog. Asking again with the same key returns the same sale.
   *
   * @param request the products, the quantities, and the total the customer sees
   * @returns the saved sale, `no_cash_session` if the register is closed, or `catalog_changed` if a product is gone or the total is not the one on the screen
   * @throws MoneyError if a quantity is not valid for its product, or an amount passes the largest supported value
   * @throws Error from SQLite if the key belongs to a sale that was already resolved
   */
  save(request: PendingSaleRequest): SavePendingSaleResult {
    const alreadySaved = this.#sales.findPendingByIdempotencyKey(request.idempotencyKey);
    if (alreadySaved !== null) {
      return { status: 'saved', sale: alreadySaved };
    }
    const context = this.#context();
    if (context === null) {
      return { status: 'no_cash_session' };
    }
    const authorization = this.#authorizeMiscItems(request);
    if ('status' in authorization) {
      return authorization;
    }
    const sale = this.#price(request);
    if (sale === null) {
      return { status: 'catalog_changed' };
    }
    // The entries come first: if saving fails, the log says a price was typed and approved, and a sale that was saved
    // always has its entries, even when the screen asks again with the same key (ADR 0033).
    this.#recordMiscItems(sale, authorization.authorizedBy);
    this.#sales.savePendingPayment({ ...sale, ...context });
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
   * Cancels a pending sale that was not paid.
   *
   * @param saleId the sale
   * @throws SaleNotFoundError if the sale does not exist
   * @throws InvalidSaleTransitionError if the sale is not pending
   */
  cancel(saleId: string): void {
    this.#sales.cancel(saleId);
  }

  /** A price typed by hand needs the owner: the owner signed in, or the PIN of the owner when a cashier sells it. */
  #authorizeMiscItems(request: PendingSaleRequest): { authorizedBy: string | null } | Extract<SavePendingSaleResult, { status: 'authorization_required' | 'wrong_pin' | 'locked' }> {
    if (!request.lines.some((line) => 'miscellaneous' in line)) {
      return { authorizedBy: null };
    }
    const user = this.#misc?.auth.currentUser() ?? null;
    if (this.#misc === null || user === null) {
      throw new Error('A miscellaneous item needs a person signed in');
    }
    if (user.role === 'owner') {
      return { authorizedBy: user.id };
    }
    if (request.ownerPin === undefined || request.ownerPin === '') {
      return { status: 'authorization_required' };
    }
    const result = this.#misc.auth.authorizeWithOwnerPin(request.ownerPin);
    return result.status === 'ok' ? { authorizedBy: result.owner.id } : result;
  }

  #recordMiscItems(sale: SaleToSave, authorizedBy: string | null): void {
    const user = this.#misc?.auth.currentUser();
    if (this.#misc === null || user === null || user === undefined || authorizedBy === null) {
      return;
    }
    for (const line of sale.lines.filter((candidate) => candidate.productId === MISC_PRODUCT_ID)) {
      this.#misc.audit.record({
        userId: user.id,
        action: 'sale.misc_item',
        entity: 'sale',
        entityId: sale.saleId,
        detail: `${line.productName}, ${line.quantity.milli} thousandths at ${line.unitPriceE4} ten-thousandths each; approved by ${authorizedBy}`,
      });
    }
  }

  #price(request: PendingSaleRequest): SaleToSave | null {
    const lines: SaleLineToSave[] = [];
    for (const requested of request.lines) {
      if ('miscellaneous' in requested) {
        lines.push(this.#miscLine(requested.miscellaneous, requested.quantityMilli));
        continue;
      }
      const { productId, quantityMilli } = requested;
      const product = this.#catalog.findById(productId);
      if (product === null) {
        return null;
      }
      const unitPriceE4 = this.#honoredPrice(productId, product.unitPriceE4, requested.unitPriceE4);
      if (unitPriceE4 === null) {
        return null;
      }
      const quantity = quantityOf(quantityMilli, product.unit);
      lines.push({
        id: uuidV7(),
        productId,
        productName: product.name,
        quantity,
        unitPriceE4,
        totals: lineTotals(unitPriceE4, quantity, product.taxRate),
      });
    }
    const { subtotalCents, taxCents, totalCents } = saleTotals(lines.map((line) => line.totals));
    if (totalCents !== request.expectedTotalCents) {
      return null;
    }
    return { saleId: uuidV7(), idempotencyKey: request.idempotencyKey, lines, subtotalCents, taxCents, totalCents };
  }

  /**
   * The price of a line is the one of the catalog, except when the owner changed it while the sale was being rung up: then
   * the price the cashier saw is honored, but only if it is the one the owner replaced. Any other price is not one the
   * owner ever approved, so the sale is not saved.
   */
  #honoredPrice(productId: string, catalogPrice: number, seenPrice: number | undefined): number | null {
    if (seenPrice === undefined || seenPrice === catalogPrice) {
      return catalogPrice;
    }
    return this.#priceHistory?.previousPriceOf(productId) === seenPrice ? seenPrice : null;
  }

  #miscLine({ name, unitPriceE4 }: { readonly name: string; readonly unitPriceE4: number }, quantityMilli: number): SaleLineToSave {
    const quantity = quantityOf(quantityMilli, 'piece');
    return {
      id: uuidV7(),
      productId: MISC_PRODUCT_ID,
      productName: name,
      quantity,
      unitPriceE4,
      totals: lineTotals(unitPriceE4, quantity, taxRateOf('rate', MISC_TAX_RATE_BP)),
    };
  }
}

/** What selling a miscellaneous item needs besides the catalog: who is signed in, who can approve, and where it is written down. */
export interface MiscSupport {
  readonly auth: Pick<AuthService, 'currentUser' | 'authorizeWithOwnerPin'>;
  readonly audit: Pick<AuditLog, 'record'>;
}
