import { describe, expect, it } from 'vitest';

import { parseCreateUserRequest, parseLoginRequest, parsePin, parseSetupRequest } from './auth-request';

const USER_ID = '019a5f2e-7c40-7b1a-9d2e-3f4a5b6c7d8e';

describe('parseLoginRequest', () => {
  it('returns the user and the PIN, and nothing else', () => {
    expect(parseLoginRequest({ userId: USER_ID, pin: '4321', role: 'owner' })).toEqual({ userId: USER_ID, pin: '4321' });
  });

  it.each([
    ['nothing', undefined],
    ['a user id that is not a UUIDv7', { userId: crypto.randomUUID(), pin: '4321' }],
    ['a PIN that is not text', { userId: USER_ID, pin: 4321 }],
    ['a PIN that is too long to be one', { userId: USER_ID, pin: '123456789' }],
  ])('refuses %s', (_case, value) => {
    expect(() => parseLoginRequest(value)).toThrow(TypeError);
  });
});

describe('parseSetupRequest', () => {
  it('returns the name and the PIN', () => {
    expect(parseSetupRequest({ name: 'Mauricio', pin: '4321' })).toEqual({ name: 'Mauricio', pin: '4321' });
  });

  it.each([
    ['a name that is not text', { name: 1, pin: '4321' }],
    ['a name that is too long', { name: 'x'.repeat(41), pin: '4321' }],
    ['no PIN', { name: 'Mauricio' }],
  ])('refuses %s', (_case, value) => {
    expect(() => parseSetupRequest(value)).toThrow(TypeError);
  });
});

describe('parseCreateUserRequest', () => {
  it('accepts the roles the register has', () => {
    expect(parseCreateUserRequest({ name: 'Ana', role: 'cashier', pin: '5555' })).toEqual({ name: 'Ana', role: 'cashier', pin: '5555' });
    expect(parseCreateUserRequest({ name: 'Ana', role: 'owner', pin: '5555' }).role).toBe('owner');
  });

  it.each([['admin'], [undefined], [3]])('refuses the role %j', (role) => {
    expect(() => parseCreateUserRequest({ name: 'Ana', role, pin: '5555' })).toThrow(TypeError);
  });
});

describe('parsePin', () => {
  it('returns a text of up to eight characters', () => {
    expect(parsePin('4321')).toBe('4321');
  });

  it.each([[undefined], [null], [4321], ['123456789']])('refuses %j', (value) => {
    expect(() => parsePin(value)).toThrow(TypeError);
  });
});
