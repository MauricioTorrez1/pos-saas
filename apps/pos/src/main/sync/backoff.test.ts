import { describe, expect, it } from 'vitest';

import { backoffDelayMs, DEFAULT_BACKOFF } from './backoff';

describe('backoff between failed pushes', () => {
  it('doubles the wait after each failure, up to the ceiling', () => {
    const waits = [1, 2, 3, 4, 5, 6, 7, 20].map((failures) => backoffDelayMs(failures, DEFAULT_BACKOFF, 0.999999));

    expect(waits).toEqual([4999, 9999, 19999, 39999, 59999, 59999, 59999, 59999]);
  });

  it('never waits less than half of the exponential value, and never more than all of it', () => {
    expect(backoffDelayMs(3, DEFAULT_BACKOFF, 0)).toBe(10_000);
    expect(backoffDelayMs(3, DEFAULT_BACKOFF, 0.5)).toBe(15_000);
  });

  it('spreads registers that failed together, so they do not return at the same instant', () => {
    const waits = new Set([0, 0.2, 0.4, 0.6, 0.8].map((random) => backoffDelayMs(4, DEFAULT_BACKOFF, random)));

    expect(waits.size).toBe(5);
  });

  it('does not overflow after a very long outage', () => {
    expect(backoffDelayMs(10_000, DEFAULT_BACKOFF, 0.5)).toBe(45_000);
  });

  it.each([0, -1, 1.5, Number.NaN])('refuses %s failures', (failures) => {
    expect(() => backoffDelayMs(failures)).toThrow(RangeError);
  });
});
