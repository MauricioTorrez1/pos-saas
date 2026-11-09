import { describe, expect, it } from 'vitest';

import { parseCloseRequest, parseLimitRequest, parseMovementRequest, parseOpenRequest } from './cash-request';

describe('parseOpenRequest', () => {
  it('returns the float, which may be zero', () => {
    expect(parseOpenRequest({ floatCents: 50000 })).toBe(50000);
    expect(parseOpenRequest({ floatCents: 0 })).toBe(0);
  });

  it.each([[undefined], [{}], [{ floatCents: -1 }], [{ floatCents: 1.5 }], [{ floatCents: '500' }]])('refuses %j', (value) => {
    expect(() => parseOpenRequest(value)).toThrow(TypeError);
  });
});

describe('parseLimitRequest', () => {
  it('returns a positive limit', () => {
    expect(parseLimitRequest({ limitCents: 500_000 })).toBe(500_000);
  });

  it.each([[{ limitCents: 0 }], [{ limitCents: -5 }], [{}]])('refuses %j', (value) => {
    expect(() => parseLimitRequest(value)).toThrow(TypeError);
  });
});

describe('parseMovementRequest', () => {
  const VALID = { kind: 'out', amountCents: 3500, reason: 'Proveedor' } as const;

  it('returns the movement, keeping the owner PIN only when it was sent', () => {
    expect(parseMovementRequest(VALID)).toEqual(VALID);
    expect(parseMovementRequest({ ...VALID, ownerPin: '4321', extra: 1 })).toEqual({ ...VALID, ownerPin: '4321' });
  });

  it.each([
    ['a kind that does not exist', { ...VALID, kind: 'gift' }],
    ['no amount', { ...VALID, amountCents: 0 }],
    ['an amount with decimals', { ...VALID, amountCents: 10.5 }],
    ['a reason that is not text', { ...VALID, reason: 5 }],
    ['a reason that is too long', { ...VALID, reason: 'x'.repeat(201) }],
    ['an owner PIN that is too long to be one', { ...VALID, ownerPin: '123456789' }],
  ])('refuses %s', (_case, value) => {
    expect(() => parseMovementRequest(value)).toThrow(TypeError);
  });
});

describe('parseCloseRequest', () => {
  const VALID = { counts: { 50000: 1, 100: 3 }, cardCountedCents: 0, transferCountedCents: 0, reason: '' };

  it('returns what was counted', () => {
    expect(parseCloseRequest(VALID)).toEqual(VALID);
  });

  it.each([
    ['a piece that does not exist', { ...VALID, counts: { 300: 1 } }],
    ['a negative count', { ...VALID, counts: { 100: -1 } }],
    ['a count with decimals', { ...VALID, counts: { 100: 1.5 } }],
    ['counts that are not an object', { ...VALID, counts: [] }],
    ['a card total in text', { ...VALID, cardCountedCents: '0' }],
    ['no transfer total', { ...VALID, transferCountedCents: undefined }],
  ])('refuses %s', (_case, value) => {
    expect(() => parseCloseRequest(value)).toThrow(TypeError);
  });
});
