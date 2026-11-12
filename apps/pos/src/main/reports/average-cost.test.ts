import { describe, expect, it } from 'vitest';

import { averageCostE6, costInCents, divideHalfUp } from './average-cost';

describe('the weighted average cost', () => {
  it('is unknown without an entry that has a cost', () => {
    expect(averageCostE6([])).toBeNull();
  });

  it('is the cost of the first entry', () => {
    expect(averageCostE6([{ quantityMilli: 10_000, unitCostE6: 5_000_000, stockBeforeMilli: 0 }])).toBe(5_000_000);
  });

  it('mixes a second entry with the stock that is left, not with what was bought before', () => {
    // 10 units at $5.00 and 4 sold leaves 6; 6 more at $8.00 give (6 × 5 + 6 × 8) / 12 = $6.50.
    expect(
      averageCostE6([
        { quantityMilli: 10_000, unitCostE6: 5_000_000, stockBeforeMilli: 0 },
        { quantityMilli: 6_000, unitCostE6: 8_000_000, stockBeforeMilli: 6_000 },
      ]),
    ).toBe(6_500_000);
  });

  it('rounds half up in millionths of a peso', () => {
    // (1 × 1.000000 + 2 × 1.000001) / 3 = 1.000000666…, which is 1000001 millionths.
    expect(
      averageCostE6([
        { quantityMilli: 1_000, unitCostE6: 1_000_000, stockBeforeMilli: 0 },
        { quantityMilli: 2_000, unitCostE6: 1_000_001, stockBeforeMilli: 1_000 },
      ]),
    ).toBe(1_000_001);
    // (1 × 0 + 1 × 1) / 2 = 0.5 millionths, which rounds up to 1.
    expect(
      averageCostE6([
        { quantityMilli: 1_000, unitCostE6: 0, stockBeforeMilli: 0 },
        { quantityMilli: 1_000, unitCostE6: 1, stockBeforeMilli: 1_000 },
      ]),
    ).toBe(1);
  });

  it('takes the cost of the entry when the shelf was empty or negative and the entry leaves stock', () => {
    expect(
      averageCostE6([
        { quantityMilli: 5_000, unitCostE6: 5_000_000, stockBeforeMilli: 0 },
        { quantityMilli: 8_000, unitCostE6: 9_000_000, stockBeforeMilli: -2_000 },
      ]),
    ).toBe(9_000_000);
  });

  it('keeps the average when an entry still leaves the stock at zero or below', () => {
    expect(
      averageCostE6([
        { quantityMilli: 5_000, unitCostE6: 5_000_000, stockBeforeMilli: 0 },
        { quantityMilli: 2_000, unitCostE6: 9_000_000, stockBeforeMilli: -2_000 },
      ]),
    ).toBe(5_000_000);
  });

  it('does not overflow with large stock and costs', () => {
    const huge = 9_000_000_000_000;
    expect(averageCostE6([{ quantityMilli: 1, unitCostE6: 1_000_000_000, stockBeforeMilli: huge }, { quantityMilli: 1, unitCostE6: 1_000_000_000, stockBeforeMilli: huge }])).toBe(1_000_000_000);
  });

  it('prices an amount to the cent, rounding half up', () => {
    // 3.275 m at $5.00 is $16.375, which is 1637.5 cents.
    expect(costInCents(3_275, 5_000_000)).toBe(1_638);
    expect(costInCents(1_000, 60_000_000)).toBe(6_000);
    expect(costInCents(0, 60_000_000)).toBe(0);
    expect(divideHalfUp(5n, 2n)).toBe(3n);
    expect(divideHalfUp(4n, 3n)).toBe(1n);
  });
});
