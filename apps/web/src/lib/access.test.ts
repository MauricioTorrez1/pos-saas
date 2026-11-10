import { describe, expect, it } from 'vitest';
import { canAccess } from './access';

describe('canAccess', () => {
  it('lets any signed-in user open a route without rules', () => {
    expect(canAccess('/dashboard', [])).toBe(true);
    expect(canAccess('/dashboard', ['cashier'])).toBe(true);
  });

  it('lets the owner and the manager open the catalog, and nobody else', () => {
    expect(canAccess('/catalog', ['owner'])).toBe(true);
    expect(canAccess('/catalog/new', ['manager'])).toBe(true);
    expect(canAccess('/catalog', ['cashier'])).toBe(false);
    expect(canAccess('/catalog', [])).toBe(false);
  });

  it('lets only the owner open the settings', () => {
    expect(canAccess('/settings', ['owner'])).toBe(true);
    expect(canAccess('/settings', ['manager', 'cashier'])).toBe(false);
  });

  it('does not confuse a route that only starts with the same letters', () => {
    expect(canAccess('/catalogue', [])).toBe(true);
  });
});
