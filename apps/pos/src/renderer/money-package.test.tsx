import { formatCents } from '@pos-saas/money';
import { describe, expect, it } from 'vitest';

// The screen shows amounts, so it must reach the package without Node.
describe('money package on the screen', () => {
  it('formats an amount through the package export', () => {
    expect(formatCents(4094)).toBe('$40.94');
  });
});
