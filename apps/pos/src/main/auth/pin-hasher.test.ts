import { describe, expect, it } from 'vitest';

import { hashPin, isValidPin, verifyPin } from './pin-hasher';

describe('isValidPin', () => {
  it.each([['1234'], ['0000'], ['12345678']])('accepts %j', (pin) => {
    expect(isValidPin(pin)).toBe(true);
  });

  it.each([[''], ['123'], ['123456789'], ['12a4'], ['12 34'], ['１２３４'], [' 1234']])('refuses %j', (pin) => {
    expect(isValidPin(pin)).toBe(false);
  });
});

describe('hashPin', () => {
  it('never contains the PIN, and gives a different hash each time because of its salt', () => {
    const first = hashPin('4321');
    const second = hashPin('4321');

    expect(first).not.toContain('4321');
    expect(first).not.toBe(second);
  });

  it('keeps the settings of the hash with it, so they can be raised later without breaking old PINs', () => {
    expect(hashPin('4321')).toMatch(/^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  });

  it('refuses a PIN that is not four to eight digits', () => {
    expect(() => hashPin('12')).toThrow(RangeError);
  });
});

describe('verifyPin', () => {
  it('accepts the right PIN and refuses a wrong one', () => {
    const stored = hashPin('4321');

    expect(verifyPin('4321', stored)).toBe(true);
    expect(verifyPin('4322', stored)).toBe(false);
    expect(verifyPin('', stored)).toBe(false);
  });

  it('refuses a stored value that is damaged, instead of throwing', () => {
    expect(verifyPin('4321', 'nonsense')).toBe(false);
    expect(verifyPin('4321', 'scrypt$1$1$1$AAAA$AAAA')).toBe(false);
    expect(verifyPin('4321', '')).toBe(false);
  });
});
