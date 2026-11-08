import { describe, expect, it } from 'vitest';

import { assertSaleTransition, InvalidSaleTransitionError, SALE_STATUSES, type SaleStatus } from './sale-state-machine';

const SALE_ID = '019a5f2e-7c40-7b1a-9d2e-3f4a5b6c7d8e';

/** Written out here, so a transition added to the machine by mistake fails this test. */
const ALLOWED_TRANSITIONS: readonly (readonly [SaleStatus, SaleStatus])[] = [
  ['pending_payment', 'completed'],
  ['pending_payment', 'cancelled'],
];

function isAllowed(from: SaleStatus, to: SaleStatus): boolean {
  return ALLOWED_TRANSITIONS.some(([allowedFrom, allowedTo]) => allowedFrom === from && allowedTo === to);
}

const EVERY_PAIR = SALE_STATUSES.flatMap((from) => SALE_STATUSES.map((to) => [from, to] as const));

describe('assertSaleTransition', () => {
  it('knows the three states of the first delivery', () => {
    expect(SALE_STATUSES).toEqual(['pending_payment', 'completed', 'cancelled']);
  });

  it.each(EVERY_PAIR.filter(([from, to]) => isAllowed(from, to)))('allows %s to %s', (from, to) => {
    expect(() => assertSaleTransition(SALE_ID, from, to)).not.toThrow();
  });

  it.each(EVERY_PAIR.filter(([from, to]) => !isAllowed(from, to)))('refuses %s to %s', (from, to) => {
    expect(() => assertSaleTransition(SALE_ID, from, to)).toThrow(InvalidSaleTransitionError);
  });

  it('names the sale and both states in the error', () => {
    expect(() => assertSaleTransition(SALE_ID, 'completed', 'cancelled')).toThrow(
      `Sale ${SALE_ID} cannot go from completed to cancelled`,
    );
  });
});
