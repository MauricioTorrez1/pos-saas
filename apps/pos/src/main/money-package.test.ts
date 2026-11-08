import { lineAmountCents, parseQuantity, sumCents } from '@pos-saas/money';
import { describe, expect, it } from 'vitest';

// Checks the wiring, not the math: the shared cases already cover the math in packages/money.
describe('money package in the main process', () => {
  it('calculates a sale line through the package export', () => {
    const cable = lineAmountCents(125000, parseQuantity('3.275', 'meter'));

    expect(sumCents([cable])).toBe(4094);
  });
});
