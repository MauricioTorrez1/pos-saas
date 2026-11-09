import type { LineTotals, Quantity } from '@pos-saas/money';

/**
 * How a customer can pay. A card payment keeps its authorization code or the folio of the terminal, never card data.
 * `card_manual` is a card charged on the standalone terminal, with the folio typed by the cashier (RF-016).
 */
export const PAYMENT_METHODS = ['cash', 'transfer', 'card', 'card_manual'] as const;

/** One of the ways to pay. */
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * One part of what a sale was paid with. The amounts of all the parts add up to the total of the sale, so a cash part
 * is what the cash paid and never what the customer handed over (the change is not part of the sale).
 */
export interface SalePayment {
  readonly method: PaymentMethod;
  /** What this part paid, in cents. Always positive. */
  readonly amountCents: number;
  /** The reference of a transfer or the authorization code of a card. Cash has none. */
  readonly reference: string | null;
}

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
  /** The cash session the sale was made in, so the cut can count it. */
  readonly cashSessionId?: string;
  /** Who made the sale. */
  readonly cashierId?: string;
}

/** How the customer pays one attempt: at the counter with cash and transfers, or on the card terminal. */
export type CheckoutPayment =
  | {
      readonly kind: 'in_person';
      /** The parts, which must add up to the total. */
      readonly payments: readonly SalePayment[];
      /** Cash to give back, for the ticket and the screen. */
      readonly changeCents: number;
    }
  | { readonly kind: 'card' };

/** The sale as checkout needs it: what gets saved, and how the customer pays this attempt. */
export interface SaleToCheckout extends SaleToSave {
  readonly payment: CheckoutPayment;
}

/** What completing a sale gives back. */
export interface CompletedSale {
  /** The number of the sale in this register, starting at 1 and without gaps. Only completed sales have one. */
  readonly folio: number;
  /** When it was completed, in ISO 8601. */
  readonly completedAt: string;
}

/** A completed sale read back from the database, with everything a ticket needs. */
export interface CompletedSaleRecord extends CompletedSale {
  readonly sale: SaleToSave;
  readonly payments: readonly SalePayment[];
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
   * Marks a pending sale as `completed`, with all its payments in the same transaction.
   *
   * @param saleId the sale that was paid
   * @param payments the parts it was paid with, which must add up to its total
   * @returns the folio the sale got and when it was completed, for the ticket
   */
  markCompleted(saleId: string, payments: readonly SalePayment[]): CompletedSale;
}
