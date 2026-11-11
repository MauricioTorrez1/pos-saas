import { describe, expect, it } from 'vitest';
import { canAccess, rolesRequiredFor } from './access';

describe('canAccess', () => {
  it('lets any signed-in user open a route without rules', () => {
    expect(canAccess('/dashboard', null)).toBe(true);
    expect(canAccess('/dashboard', 'cashier')).toBe(true);
  });

  it('lets the owner and the manager open the catalog, and nobody else', () => {
    expect(canAccess('/catalog', 'owner')).toBe(true);
    expect(canAccess('/catalog/new', 'manager')).toBe(true);
    expect(canAccess('/catalog', 'cashier')).toBe(false);
    expect(canAccess('/catalog', null)).toBe(false);
  });

  it('lets only the owner open the settings', () => {
    expect(canAccess('/settings', 'owner')).toBe(true);
    expect(canAccess('/settings', 'manager')).toBe(false);
    expect(canAccess('/settings', 'cashier')).toBe(false);
  });

  it('does not confuse a route that only starts with the same letters', () => {
    expect(canAccess('/catalogue', null)).toBe(true);
  });
});

describe('rolesRequiredFor', () => {
  it('tells which routes need the core to be asked', () => {
    expect(rolesRequiredFor('/catalog')).toEqual(['owner', 'manager']);
    expect(rolesRequiredFor('/dashboard')).toBeNull();
  });
});
