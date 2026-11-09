import { sumCents } from '@pos-saas/money';

/** One transfer the customer made, with the reference the bank gave. */
export interface TransferTender {
  readonly amountCents: number;
  readonly reference: string;
}

/** What the customer hands over, before it is matched against the total. */
export interface PaymentTender {
  /** All the cash received, in cents. The change comes out of it. */
  readonly cashReceivedCents: number;
  readonly transfers: readonly TransferTender[];
}

/** One payment to record. A cash payment records what it paid, and keeps what was handed over to show the change. */
export type PlannedPayment =
  | { readonly method: 'cash'; readonly amountCents: number; readonly tenderedCents: number }
  | { readonly method: 'transfer'; readonly amountCents: number; readonly reference: string };

/** Whether a tender can complete a sale, and if not, why. */
export type PaymentPlan =
  | {
      readonly status: 'ready';
      /** Payments that add up to the total, cash first. */
      readonly payments: readonly PlannedPayment[];
      /** Cash to give back. It is 0 unless the cash received passes what the cash had to pay. */
      readonly changeCents: number;
    }
  | { readonly status: 'short'; readonly missingCents: number }
  | { readonly status: 'transfers_exceed_total'; readonly excessCents: number }
  | { readonly status: 'cash_not_needed'; readonly excessCents: number }
  | { readonly status: 'reference_missing' };

/**
 * Matches what the customer hands over against the total (RF-014, RF-015). Transfers are exact, because a bank does
 * not give change, so the cash pays what the transfers leave and the change comes out of the cash.
 *
 * @param totalCents the total of the sale, in cents
 * @param tender the cash received and the transfers
 * @returns `ready` with the payments to record and the change, or the reason the sale cannot be completed yet
 * @throws MoneyError if an amount is negative or not an integer
 * @throws RangeError if a transfer is for $0
 */
export function planPayments(totalCents: number, tender: PaymentTender): PaymentPlan {
  const transfers = tender.transfers.map(({ amountCents, reference }) => ({ amountCents, reference: reference.trim() }));
  if (transfers.some(({ amountCents }) => amountCents === 0)) {
    throw new RangeError('A transfer must be for more than $0');
  }
  const transferredCents = sumCents(transfers.map(({ amountCents }) => amountCents));
  const receivedCents = sumCents([tender.cashReceivedCents, transferredCents]);

  if (transferredCents > totalCents) {
    return { status: 'transfers_exceed_total', excessCents: transferredCents - totalCents };
  }
  if (receivedCents < 0) {
    return { status: 'short', missingCents: totalCents - receivedCents };
  }
  const cashDueCents = totalCents - transferredCents;
  if (cashDueCents === 0 && tender.cashReceivedCents > 0) {
    return { status: 'cash_not_needed', excessCents: tender.cashReceivedCents };
  }
  if (transfers.some(({ reference }) => reference === '')) {
    return { status: 'reference_missing' };
  }

  const cashPayments: PlannedPayment[] =
    cashDueCents > 0 ? [{ method: 'cash', amountCents: cashDueCents, tenderedCents: tender.cashReceivedCents }] : [];
  return {
    status: 'ready',
    payments: [...cashPayments, ...transfers.map((transfer) => ({ method: 'transfer' as const, ...transfer }))],
    changeCents: tender.cashReceivedCents - cashDueCents,
  };
}
