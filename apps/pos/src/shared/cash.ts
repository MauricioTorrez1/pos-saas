/** Bills and coins of Mexico, in cents, from the largest to the smallest. */
export const DENOMINATIONS_CENTS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50] as const;

/** A limit of $5,000 in the drawer, until the owner picks another (RF-026). */
export const DEFAULT_WITHDRAWAL_LIMIT_CENTS = 500_000;

/** Everything that moved in a cash session, in cents. A refund is kept apart from the sale it undoes. */
export interface CashTotals {
  /** The cash the session started with. */
  readonly openingFloatCents: number;
  readonly cashSalesCents: number;
  readonly cardSalesCents: number;
  readonly transferSalesCents: number;
  /** Cash put into the drawer with a reason. */
  readonly cashInCents: number;
  /** Cash taken out of the drawer with a reason, such as paying a supplier. */
  readonly cashOutCents: number;
  readonly cashRefundsCents: number;
  readonly cardRefundsCents: number;
  readonly transferRefundsCents: number;
}

/** What the drawer should hold, a card should have charged, and the bank should have received. */
export interface ExpectedCut {
  readonly cashCents: number;
  readonly cardCents: number;
  readonly transferCents: number;
}

/** One form of payment of a cut. A negative difference is a shortage. */
export interface CutLine {
  readonly expectedCents: number;
  readonly countedCents: number;
  readonly differenceCents: number;
}

/** What a cut found, form of payment by form of payment (RF-027). */
export interface CutComparison {
  readonly cash: CutLine;
  readonly card: CutLine;
  readonly transfer: CutLine;
  /** True when no form of payment is off, so no reason is needed. */
  readonly isBalanced: boolean;
}

/**
 * Works out the cash the drawer should hold: the float, the cash sales, and the entries, less the exits and the refunds
 * paid in cash. The card and the transfers never touch the drawer (RF-025).
 *
 * @param totals what moved in the session
 * @returns the expected cash, in cents
 */
export function expectedCashCents(totals: CashTotals): number {
  return totals.openingFloatCents + totals.cashSalesCents + totals.cashInCents - totals.cashOutCents - totals.cashRefundsCents;
}

/**
 * Works out what a cut should find for each form of payment.
 *
 * @param totals what moved in the session
 * @returns the expected cash, card, and transfers
 */
export function expectedCut(totals: CashTotals): ExpectedCut {
  return {
    cashCents: expectedCashCents(totals),
    cardCents: totals.cardSalesCents - totals.cardRefundsCents,
    transferCents: totals.transferSalesCents - totals.transferRefundsCents,
  };
}

/**
 * Tells whether the register should ask the cashier to take cash out of the drawer. It only warns, and never stops a
 * sale (RF-026).
 *
 * @param expectedCashCents the cash the drawer should hold
 * @param limitCents the limit the owner chose
 * @returns true when the cash is above the limit
 */
export function shouldWithdraw(expectedCashCents: number, limitCents: number): boolean {
  return expectedCashCents > limitCents;
}

/**
 * Adds up the bills and coins that were counted.
 *
 * @param counts how many of each denomination, keyed by its value in cents
 * @returns the counted cash, in cents
 * @throws RangeError if a denomination does not exist or a count is not a whole non-negative number
 */
export function countCash(counts: Readonly<Record<number, number>>): number {
  let totalCents = 0;
  for (const [denomination, count] of Object.entries(counts)) {
    const value = Number(denomination);
    if (!(DENOMINATIONS_CENTS as readonly number[]).includes(value)) {
      throw new RangeError(`${denomination} cents is not a bill or a coin`);
    }
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new RangeError(`Expected a whole number of ${denomination}-cent pieces, got ${count}`);
    }
    totalCents += value * count;
  }
  return totalCents;
}

/**
 * Compares what a cut found with what it should have found, for each form of payment (RF-027).
 *
 * @param expected what the sales say
 * @param counted what was counted in the drawer and in the vouchers
 * @returns the difference of each form of payment, negative for a shortage
 */
export function compareCut(expected: ExpectedCut, counted: ExpectedCut): CutComparison {
  const line = (expectedCents: number, countedCents: number): CutLine => ({
    expectedCents,
    countedCents,
    differenceCents: countedCents - expectedCents,
  });
  const cash = line(expected.cashCents, counted.cashCents);
  const card = line(expected.cardCents, counted.cardCents);
  const transfer = line(expected.transferCents, counted.transferCents);
  return { cash, card, transfer, isBalanced: [cash, card, transfer].every(({ differenceCents }) => differenceCents === 0) };
}
