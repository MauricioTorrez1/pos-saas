/** How a sale was paid, as the register records it. A card payment keeps its authorization code, never card data. */
export type RecordedPayment =
  | { readonly method: 'cash' }
  | { readonly method: 'card'; readonly authorizationCode: string };

/** The sale as checkout needs it. Lines, taxes, and the ticket layout arrive with E1-05 to E1-13. */
export interface SaleToCheckout {
  /** UUIDv7 of the sale. It stays the same across payment attempts. */
  readonly saleId: string;
  /** New for every payment attempt, and the same for every retry of that attempt. */
  readonly idempotencyKey: string;
  /** Positive amount to collect, in cents. */
  readonly totalCents: number;
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
 * because `LocalStore` is: when one returns, the change is on disk. E1-10 writes it on `LocalStore`.
 */
export interface SaleRecorder {
  /**
   * Saves the sale as `pending_payment`. A sale that is still pending can be saved again, so the cashier
   * can try another payment method after a declined card.
   *
   * @param sale the sale about to be charged
   * @throws SaleAlreadyCompletedError if the sale was already completed
   */
  savePendingPayment(sale: SaleToCheckout): void;

  /**
   * Marks a pending sale as `completed`, with its payment.
   *
   * @param saleId the sale that was paid
   * @param payment how it was paid
   */
  markCompleted(saleId: string, payment: RecordedPayment): void;
}
