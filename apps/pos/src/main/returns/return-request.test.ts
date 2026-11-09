import { describe, expect, it } from 'vitest';

import { MAX_RETURN_LINES, parseFolioText, parseReturnRequest } from './return-request';

const SALE_ID = '019a5f2e-7c40-7b1a-9d2e-3f4a5b6c7d8e';
const LINE_ID = '019a5f2e-7c41-7b1a-9d2e-3f4a5b6c7d8f';
const VALID = { saleId: SALE_ID, lines: [{ saleLineId: LINE_ID, quantityMilli: 1000 }], reason: 'No era el modelo' };

describe('parseReturnRequest', () => {
  it('returns the return, keeping the PIN and the override only when they were sent', () => {
    expect(parseReturnRequest(VALID)).toEqual(VALID);
    expect(parseReturnRequest({ ...VALID, ownerPin: '4321', override: true, extra: 1 })).toEqual({ ...VALID, ownerPin: '4321', override: true });
  });

  it('accepts a line of zero, which the service ignores', () => {
    expect(parseReturnRequest({ ...VALID, lines: [{ saleLineId: LINE_ID, quantityMilli: 0 }] }).lines).toHaveLength(1);
  });

  it.each([
    ['nothing', undefined],
    ['a sale that is not a UUIDv7', { ...VALID, saleId: crypto.randomUUID() }],
    ['lines that are not a list', { ...VALID, lines: 'x' }],
    ['too many lines', { ...VALID, lines: Array.from({ length: MAX_RETURN_LINES + 1 }, () => VALID.lines[0]) }],
    ['a line that is not an object', { ...VALID, lines: [null] }],
    ['a line id that is not a UUIDv7', { ...VALID, lines: [{ saleLineId: 'x', quantityMilli: 1000 }] }],
    ['a negative quantity', { ...VALID, lines: [{ saleLineId: LINE_ID, quantityMilli: -1 }] }],
    ['a quantity with decimals', { ...VALID, lines: [{ saleLineId: LINE_ID, quantityMilli: 1.5 }] }],
    ['a reason that is not text', { ...VALID, reason: 5 }],
    ['a reason that is too long', { ...VALID, reason: 'x'.repeat(201) }],
    ['a PIN that is too long to be one', { ...VALID, ownerPin: '123456789' }],
    ['an override that is not true or false', { ...VALID, override: 'yes' }],
  ])('refuses %s', (_case, value) => {
    expect(() => parseReturnRequest(value)).toThrow(TypeError);
  });
});

describe('parseFolioText', () => {
  it('returns the text', () => {
    expect(parseFolioText('T1-000123')).toBe('T1-000123');
  });

  it.each([[undefined], [123], ['x'.repeat(21)]])('refuses %j', (value) => {
    expect(() => parseFolioText(value)).toThrow(TypeError);
  });
});
