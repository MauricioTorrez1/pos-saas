import { describe, expect, it } from 'vitest';

import { allocateRefund, daysBetween, policyViolations, refundForLine, RETURN_WINDOW_DAYS, type LineRefundInput } from './returns';

describe('refundForLine (RF-019)', () => {
  it('gives back the whole line when all of it comes back', () => {
    expect(refundForLine({ lineTotalCents: 11600, soldMilli: 1000, returnMilli: 1000, alreadyRefundedCents: 0, alreadyReturnedMilli: 0 })).toBe(11600);
  });

  it('gives back a share of the line, rounded half up', () => {
    // 3 of 7 tornillos paid with $1.00 for 7: 100 * 3 / 7 = 42.86 cents.
    expect(refundForLine({ lineTotalCents: 100, soldMilli: 7000, returnMilli: 3000, alreadyRefundedCents: 0, alreadyReturnedMilli: 0 })).toBe(43);
  });

  it('gives back $13.56 for 1.085 m of the 3.275 m of cable that cost $40.94', () => {
    expect(refundForLine({ lineTotalCents: 4094, soldMilli: 3275, returnMilli: 1085, alreadyRefundedCents: 0, alreadyReturnedMilli: 0 })).toBe(1356);
  });

  it('closes the line to the cent when the last part comes back, so the parts never add up to more or less than it cost', () => {
    const first = refundForLine({ lineTotalCents: 100, soldMilli: 7000, returnMilli: 3000, alreadyRefundedCents: 0, alreadyReturnedMilli: 0 });
    const second = refundForLine({ lineTotalCents: 100, soldMilli: 7000, returnMilli: 4000, alreadyRefundedCents: first, alreadyReturnedMilli: 3000 });

    expect(first + second).toBe(100);
  });

  it('never gives back more than the line cost, with any split', () => {
    for (let parts = 1; parts <= 9; parts += 1) {
      let refunded = 0;
      let returned = 0;
      for (let part = 1; part <= parts; part += 1) {
        const milli = part === parts ? 9000 - returned : 1000;
        refunded += refundForLine({ lineTotalCents: 4999, soldMilli: 9000, returnMilli: milli, alreadyRefundedCents: refunded, alreadyReturnedMilli: returned });
        returned += milli;
      }
      expect(refunded).toBe(4999);
    }
  });

  it.each([
    ['nothing to return', { returnMilli: 0 }],
    ['more than was sold', { returnMilli: 1001 }],
    ['more than what is left after a previous return', { returnMilli: 600, alreadyReturnedMilli: 500, alreadyRefundedCents: 5800 }],
  ])('refuses %s', (_case, override) => {
    const base: LineRefundInput = { lineTotalCents: 11600, soldMilli: 1000, returnMilli: 500, alreadyRefundedCents: 0, alreadyReturnedMilli: 0 };

    expect(() => refundForLine({ ...base, ...override })).toThrow(RangeError);
  });

  it('does not overflow with the largest amounts', () => {
    expect(refundForLine({ lineTotalCents: 9_007_199_254_740_000, soldMilli: 9_007_199_254_740_000, returnMilli: 4_503_599_627_370_000, alreadyRefundedCents: 0, alreadyReturnedMilli: 0 })).toBe(4_503_599_627_370_000);
  });
});

describe('allocateRefund (RF-019)', () => {
  const cash = { method: 'cash' as const, reference: null, remainingCents: 6000 };
  const transfer = { method: 'transfer' as const, reference: 'SPEI-1', remainingCents: 4000 };

  it('gives it back by the same means, in proportion to what each one paid: $100 paid $60 cash and $40 transfer', () => {
    expect(allocateRefund(10000, [cash, transfer])).toEqual([
      { method: 'cash', reference: null, amountCents: 6000 },
      { method: 'transfer', reference: 'SPEI-1', amountCents: 4000 },
    ]);
  });

  it('splits a partial refund the same way', () => {
    expect(allocateRefund(5000, [cash, transfer])).toEqual([
      { method: 'cash', reference: null, amountCents: 3000 },
      { method: 'transfer', reference: 'SPEI-1', amountCents: 2000 },
    ]);
  });

  it('always adds up to the refund, even when the split leaves a cent', () => {
    const parts = [
      { method: 'cash' as const, reference: null, remainingCents: 3333 },
      { method: 'transfer' as const, reference: 'A', remainingCents: 3333 },
      { method: 'card_manual' as const, reference: 'B', remainingCents: 3334 },
    ];

    for (const refund of [1, 2, 3, 99, 100, 5001, 9999, 10000]) {
      const result = allocateRefund(refund, parts);
      expect(result.reduce((sum, part) => sum + part.amountCents, 0)).toBe(refund);
      result.forEach((part, index) => expect(part.amountCents).toBeLessThanOrEqual(parts[index]!.remainingCents));
    }
  });

  it('leaves out the means that paid nothing, or that were already given back', () => {
    expect(allocateRefund(100, [{ ...cash, remainingCents: 0 }, transfer])).toEqual([{ method: 'transfer', reference: 'SPEI-1', amountCents: 100 }]);
  });

  it('refuses to give back more than is left to give back', () => {
    expect(() => allocateRefund(10001, [cash, transfer])).toThrow(RangeError);
    expect(() => allocateRefund(0, [cash, transfer])).toThrow(RangeError);
  });
});

describe('the rules of a return', () => {
  it('counts the days between the sale and today', () => {
    expect(daysBetween('2026-10-29T20:00:00.000Z', new Date('2026-11-08T21:00:00.000Z'))).toBe(10);
    expect(daysBetween('2026-11-08T20:00:00.000Z', new Date('2026-11-08T21:00:00.000Z'))).toBe(0);
  });

  it('accepts a ticket from 10 days ago with a piece', () => {
    expect(policyViolations({ daysOld: 10, hasMeasuredProduct: false })).toEqual([]);
  });

  it('accepts the last day of the window, and refuses the next one', () => {
    expect(RETURN_WINDOW_DAYS).toBe(30);
    expect(policyViolations({ daysOld: 30, hasMeasuredProduct: false })).toEqual([]);
    expect(policyViolations({ daysOld: 31, hasMeasuredProduct: false })).toEqual(['older_than_window']);
  });

  it('refuses cut-to-measure products by default, because a cut piece cannot be sold again', () => {
    expect(policyViolations({ daysOld: 2, hasMeasuredProduct: true })).toEqual(['measured_product']);
  });

  it('names every rule that is broken', () => {
    expect(policyViolations({ daysOld: 40, hasMeasuredProduct: true })).toEqual(['older_than_window', 'measured_product']);
  });
});
