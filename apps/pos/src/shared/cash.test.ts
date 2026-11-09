import { describe, expect, it } from 'vitest';

import {
  compareCut,
  countCash,
  DEFAULT_WITHDRAWAL_LIMIT_CENTS,
  DENOMINATIONS_CENTS,
  expectedCashCents,
  shouldWithdraw,
  type CashTotals,
} from './cash';

function totals(overrides: Partial<CashTotals> = {}): CashTotals {
  return {
    openingFloatCents: 50000,
    cashSalesCents: 120000,
    cardSalesCents: 40000,
    transferSalesCents: 25000,
    cashInCents: 0,
    cashOutCents: 0,
    cashRefundsCents: 0,
    cardRefundsCents: 0,
    transferRefundsCents: 0,
    ...overrides,
  };
}

describe('expectedCashCents (RF-025)', () => {
  it('is the float plus the cash sales', () => {
    expect(expectedCashCents(totals())).toBe(170000);
  });

  it('goes up with an entry and down with an exit, such as paying a supplier in cash', () => {
    expect(expectedCashCents(totals({ cashInCents: 10000, cashOutCents: 35000 }))).toBe(145000);
  });

  it('goes down with a refund paid in cash, and not with one paid on the card', () => {
    expect(expectedCashCents(totals({ cashRefundsCents: 11600, cardRefundsCents: 5000 }))).toBe(158400);
  });

  it('does not count the card or the transfers, which never touch the drawer', () => {
    expect(expectedCashCents(totals({ cardSalesCents: 999_999, transferSalesCents: 999_999 }))).toBe(170000);
  });
});

describe('shouldWithdraw (RF-026)', () => {
  it('uses $5,000 as the default limit', () => {
    expect(DEFAULT_WITHDRAWAL_LIMIT_CENTS).toBe(500_000);
  });

  it('warns above the limit, and not at the limit itself', () => {
    expect(shouldWithdraw(500_001, 500_000)).toBe(true);
    expect(shouldWithdraw(500_000, 500_000)).toBe(false);
    expect(shouldWithdraw(499_999, 500_000)).toBe(false);
  });

  it('stops warning when a withdrawal brings the cash back down', () => {
    const before = expectedCashCents(totals({ cashSalesCents: 480_000 }));
    const after = expectedCashCents(totals({ cashSalesCents: 480_000, cashOutCents: 100_000 }));

    expect([shouldWithdraw(before, 500_000), shouldWithdraw(after, 500_000)]).toEqual([true, false]);
  });
});

describe('countCash (RF-027)', () => {
  it('knows the bills and coins of Mexico', () => {
    expect(DENOMINATIONS_CENTS).toEqual([100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50]);
  });

  it('adds up what was counted, bill by bill', () => {
    expect(countCash({ 50000: 2, 20000: 1, 100: 3, 50: 1 })).toBe(100000 + 20000 + 300 + 50);
  });

  it('is zero when nothing was counted', () => {
    expect(countCash({})).toBe(0);
  });

  it.each([
    ['a denomination that does not exist', { 300: 1 }],
    ['a negative count', { 100: -1 }],
    ['a count with decimals', { 100: 1.5 }],
  ])('refuses %s', (_case, counts) => {
    expect(() => countCash(counts)).toThrow(RangeError);
  });
});

describe('compareCut', () => {
  const expected = { cashCents: 170000, cardCents: 40000, transferCents: 25000 };

  it('has no difference when everything counted matches', () => {
    expect(compareCut(expected, { cashCents: 170000, cardCents: 40000, transferCents: 25000 })).toEqual({
      cash: { expectedCents: 170000, countedCents: 170000, differenceCents: 0 },
      card: { expectedCents: 40000, countedCents: 40000, differenceCents: 0 },
      transfer: { expectedCents: 25000, countedCents: 25000, differenceCents: 0 },
      isBalanced: true,
    });
  });

  it('shows a shortage as negative and a surplus as positive, for each form of payment', () => {
    const cut = compareCut(expected, { cashCents: 169_500, cardCents: 40_500, transferCents: 25_000 });

    expect([cut.cash.differenceCents, cut.card.differenceCents, cut.transfer.differenceCents]).toEqual([-500, 500, 0]);
    expect(cut.isBalanced).toBe(false);
  });

  it('does not balance if only one form of payment is off', () => {
    expect(compareCut(expected, { cashCents: 170000, cardCents: 40000, transferCents: 24_999 }).isBalanced).toBe(false);
  });
});
