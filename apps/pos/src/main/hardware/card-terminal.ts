/** What the register asks a card terminal to charge. It never carries card data. */
export interface CardChargeRequest {
  /** UUIDv7 of the sale being paid. */
  readonly saleId: string;
  /** The same for every retry of one payment attempt, so the customer is never charged twice. */
  readonly idempotencyKey: string;
  /** Positive amount in cents. */
  readonly amountCents: number;
}

/** The only thing the register keeps from a card payment: its outcome, never the card. */
export type CardChargeResult =
  | { readonly status: 'approved'; readonly authorizationCode: string }
  | { readonly status: 'declined'; readonly reason: string };

/** Charges cards. In Entrega 1 the cashier types the folio of a standalone terminal; Entrega 2 connects one. */
export interface CardTerminal {
  /**
   * Charges the customer's card. Asking again with the same idempotency key returns the first outcome
   * without charging again.
   *
   * @param request the sale, the attempt key, and the amount
   * @returns whether the charge was approved, with its authorization code, or declined
   * @throws DeviceError if the terminal cannot be reached. Whether the card was charged is then unknown,
   * so the sale stays pending until someone checks.
   */
  charge(request: CardChargeRequest): Promise<CardChargeResult>;
}
