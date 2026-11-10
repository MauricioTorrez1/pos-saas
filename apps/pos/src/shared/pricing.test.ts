import { taxRateOf } from '@pos-saas/money';
import { describe, expect, it } from 'vitest';

import { marginBasisPoints } from './pricing';

const SIXTEEN = taxRateOf('rate', 1600);
const EXEMPT = taxRateOf('exempt', 0);

describe('the margin of a price', () => {
  it('takes the VAT out of the price before comparing it with the cost', () => {
    // $116.00 with 16% VAT is $100.00 before tax. A cost of $60.00 leaves 40.00%.
    expect(marginBasisPoints(1_160_000, SIXTEEN, 60_000_000)).toBe(4000);
  });

  it('does not take out any VAT when the product is exempt', () => {
    expect(marginBasisPoints(1_000_000, EXEMPT, 75_000_000)).toBe(2500);
    expect(marginBasisPoints(1_000_000, EXEMPT, 60_000_000)).toBe(4000);
  });

  it('is zero when the price before tax is exactly the cost, and negative below it', () => {
    expect(marginBasisPoints(1_160_000, SIXTEEN, 100_000_000)).toBe(0);
    expect(marginBasisPoints(1_160_000, SIXTEEN, 125_000_000)).toBe(-2500);
  });

  it('rounds half away from zero to whole basis points', () => {
    // 1 / 3 of the base is 3,333.33 basis points.
    expect(marginBasisPoints(1_000_000, EXEMPT, 66_666_667)).toBe(3333);
  });

  it('answers null when nothing is left of the price after VAT', () => {
    expect(marginBasisPoints(0, SIXTEEN, 1)).toBeNull();
  });

  it('does not overflow with the largest price the register accepts', () => {
    expect(marginBasisPoints(10_000_000_000, SIXTEEN, 0)).toBe(10_000);
  });
});
