/** The states a sale goes through at the register. `card_pending` and the returns arrive with E2 and E1-15 (ADR 0025). */
export const SALE_STATUSES = ['pending_payment', 'completed', 'cancelled'] as const;

/** Where a sale is in its life. */
export type SaleStatus = (typeof SALE_STATUSES)[number];

const NEXT_STATUSES: Readonly<Record<SaleStatus, readonly SaleStatus[]>> = {
  pending_payment: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
};

/** Something tried to move a sale to a state it cannot reach from where it is. */
export class InvalidSaleTransitionError extends Error {
  /**
   * @param saleId the sale
   * @param from the state it is in
   * @param to the state it was asked to go to
   */
  constructor(saleId: string, from: SaleStatus, to: SaleStatus) {
    super(`Sale ${saleId} cannot go from ${from} to ${to}`);
    this.name = 'InvalidSaleTransitionError';
  }
}

/**
 * Checks a change of state before it is written, so an impossible one fails with a clear error.
 *
 * @param saleId the sale, for the error message
 * @param from the state it is in
 * @param to the state it is asked to go to
 * @throws InvalidSaleTransitionError if the machine does not have that step
 */
export function assertSaleTransition(saleId: string, from: SaleStatus, to: SaleStatus): void {
  if (!NEXT_STATUSES[from].includes(to)) {
    throw new InvalidSaleTransitionError(saleId, from, to);
  }
}
