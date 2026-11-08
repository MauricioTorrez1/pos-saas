import type { LineTotals, Quantity } from '@pos-saas/money';

/** How a sale was paid, as the register records it. A card payment keeps its authorization code, never card data. */
export type RecordedPayment =
  | { readonly method: 'cash' }
  | { readonly method: 'card'; readonly authorizationCode: string };

/** One product of a sale. It keeps its name and price, so the sale reads the same after the catalog changes. */
export interface SaleLineToSave {
  /** UUIDv7 of the line. */
  readonly id: string;
  readonly productId: string;
  readonly productName: string;
  readonly quantity: Quantity;
  /** Price per unit with VAT, in ten-thousandths of a peso. */
  readonly unitPriceE4: number;
  /** Its base, its VAT, its total, and the rate it was sold at. */
  readonly totals: LineTotals;
}

/** A sale with everything that has to be on disk before anything is charged. The ticket layout arrives with E1-13. */
export interface SaleToSave {
  /** UUIDv7 of the sale. It stays the same across payment attempts. */
  readonly saleId: string;
  /** New for every payment attempt, and the same for every retry of that attempt. */
  readonly idempotencyKey: string;
  readonly lines: readonly SaleLineToSave[];
  /** The base without VAT, in cents. */
  readonly subtotalCents: number;
  /** The VAT, in cents. */
  readonly taxCents: number;
  /** Positive amount to collect, in cents. */
  readonly totalCents: number;
}

/** The sale as checkout needs it: what gets saved, and how the customer pays this attempt. */
export interface SaleToCheckout extends SaleToSave {
  readonly paymentMethod: RecordedPayment['method'];
}

/** A sale that was already completed. Checking it out again could charge the customer twice. */
export class SaleAlreadyCompletedError extends Error {
  /** @param saleId the sale that is already completed */
  constructor(saleId: string) {
    super(`Sale ${saleId} is already completed`);
    this.name = 'SaleAlreadyCompletedError';
  }
}

/**
 * Where checkout saves a sale before and after charging it (ADR 0010). Both methods are synchronous
 * because `LocalStore` is: when one returns, the change is on disk.
 */
export interface SaleRecorder {
  /**
   * Saves the sale as `pending_payment`. A sale that is still pending can be saved again, so the cashier
   * can try another payment method after a declined card.
   *
   * @param sale the sale about to be charged
   * @throws SaleAlreadyCompletedError if the sale was already completed
   */
  savePendingPayment(sale: SaleToSave): void;

  /**
   * Marks a pending sale as `completed`, with its payment.
   *
   * @param saleId the sale that was paid
   * @param payment how it was paid
   */
  markCompleted(saleId: string, payment: RecordedPayment): void;
}
