import { sumCents } from '@pos-saas/money';

/** One transfer or one card payment, with the reference the bank gave or the folio of the terminal. */
export interface TransferTender {
  readonly amountCents: number;
  readonly reference: string;
}

/** What the customer hands over, before it is matched against the total. */
export interface PaymentTender {
  /** All the cash received, in cents. The change comes out of it. */
  readonly cashReceivedCents: number;
  readonly transfers: readonly TransferTender[];
  /** Payments on the standalone card terminal, each with the folio the cashier typed (RF-016). */
  readonly cards?: readonly TransferTender[];
}

/** One payment to record. A cash payment records what it paid, and keeps what was handed over to show the change. */
export type PlannedPayment =
  | { readonly method: 'cash'; readonly amountCents: number; readonly tenderedCents: number }
  | { readonly method: 'transfer'; readonly amountCents: number; readonly reference: string }
  | { readonly method: 'card_manual'; readonly amountCents: number; readonly reference: string };

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
  /** Transfers and cards give no change, so together they cannot pass the total. */
  | { readonly status: 'transfers_exceed_total'; readonly excessCents: number }
  | { readonly status: 'cash_not_needed'; readonly excessCents: number }
  | { readonly status: 'reference_missing' }
  /** A card payment needs the folio of the terminal, or it cannot be reconciled later. */
  | { readonly status: 'folio_missing' }
  /** A folio with 13 digits or more may be a card number, which the register must never keep. */
  | { readonly status: 'card_number_entered' };

/** The shortest card number is 13 digits, so a folio with that many digits in a row is refused. */
const CARD_NUMBER_DIGITS = 13;

/**
 * Matches what the customer hands over against the total (RF-014, RF-015, RF-016). Transfers and cards are exact,
 * because a bank gives no change, so the cash pays what they leave and the change comes out of the cash.
 *
 * @param totalCents the total of the sale, in cents
 * @param tender the cash received, the transfers, and the cards
 * @returns `ready` with the payments to record and the change, or the reason the sale cannot be completed yet
 * @throws MoneyError if an amount is negative or not an integer
 * @throws RangeError if a transfer or a card payment is for $0
 */
export function planPayments(totalCents: number, tender: PaymentTender): PaymentPlan {
  const transfers = trimReferences(tender.transfers);
  const cards = trimReferences(tender.cards ?? []);
  if ([...transfers, ...cards].some(({ amountCents }) => amountCents === 0)) {
    throw new RangeError('A transfer or a card payment must be for more than $0');
  }
  const exactCents = sumCents([...transfers, ...cards].map(({ amountCents }) => amountCents));
  const receivedCents = sumCents([tender.cashReceivedCents, exactCents]);

  if (exactCents > totalCents) {
    return { status: 'transfers_exceed_total', excessCents: exactCents - totalCents };
  }
  if (receivedCents < totalCents) {
    return { status: 'short', missingCents: totalCents - receivedCents };
  }
  const cashDueCents = totalCents - exactCents;
  if (cashDueCents === 0 && tender.cashReceivedCents > 0) {
    return { status: 'cash_not_needed', excessCents: tender.cashReceivedCents };
  }
  if (transfers.some(({ reference }) => reference === '')) {
    return { status: 'reference_missing' };
  }
  if (cards.some(({ reference }) => reference === '')) {
    return { status: 'folio_missing' };
  }
  if (cards.some(({ reference }) => looksLikeCardNumber(reference))) {
    return { status: 'card_number_entered' };
  }

  const cashPayments: PlannedPayment[] =
    cashDueCents > 0 ? [{ method: 'cash', amountCents: cashDueCents, tenderedCents: tender.cashReceivedCents }] : [];
  return {
    status: 'ready',
    payments: [
      ...cashPayments,
      ...transfers.map((transfer) => ({ method: 'transfer' as const, ...transfer })),
      ...cards.map((card) => ({ method: 'card_manual' as const, ...card })),
    ],
    changeCents: tender.cashReceivedCents - cashDueCents,
  };
}

function trimReferences(parts: readonly TransferTender[]): TransferTender[] {
  return parts.map(({ amountCents, reference }) => ({ amountCents, reference: reference.trim() }));
}

/** Spaces and dashes are how a card number is usually typed, so they do not hide it. */
function looksLikeCardNumber(reference: string): boolean {
  return new RegExp(`\\d{${CARD_NUMBER_DIGITS},}`).test(reference.replace(/[\s-]/g, ''));
}
