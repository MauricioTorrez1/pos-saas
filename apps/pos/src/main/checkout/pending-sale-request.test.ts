import { describe, expect, it } from 'vitest';

import { MAX_REFERENCE_LENGTH, MAX_SALE_LINES, MAX_TRANSFERS, parsePaymentRequest, parsePendingSaleRequest, parseSaleId } from './pending-sale-request';

const KEY = crypto.randomUUID();
const PRODUCT_ID = '019a5f2e-7c40-7b1a-9d2e-3f4a5b6c7d8e';
const LINE = { productId: PRODUCT_ID, quantityMilli: 3275 };
const VALID = { idempotencyKey: KEY, lines: [LINE], expectedTotalCents: 4094 };

describe('parsePendingSaleRequest', () => {
  it('returns a valid request', () => {
    expect(parsePendingSaleRequest(VALID)).toEqual(VALID);
  });

  it('accepts as many lines as a sale can have', () => {
    const lines = Array.from({ length: MAX_SALE_LINES }, () => LINE);

    expect(parsePendingSaleRequest({ ...VALID, lines }).lines).toHaveLength(MAX_SALE_LINES);
  });

  it('keeps only the fields it knows, so nothing else reaches the database', () => {
    const parsed = parsePendingSaleRequest({
      ...VALID,
      status: 'completed',
      lines: [{ ...LINE, unitPriceE4: 1 }],
    });

    expect(parsed).toEqual(VALID);
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['text', 'sale'],
    ['a list', []],
    ['no key', { ...VALID, idempotencyKey: undefined }],
    ['a key that is not a UUID', { ...VALID, idempotencyKey: 'abc' }],
    ['a key in capitals', { ...VALID, idempotencyKey: KEY.toUpperCase() }],
    ['lines that are not a list', { ...VALID, lines: 'x' }],
    ['no lines', { ...VALID, lines: [] }],
    ['too many lines', { ...VALID, lines: Array.from({ length: MAX_SALE_LINES + 1 }, () => LINE) }],
    ['a line that is not an object', { ...VALID, lines: [null] }],
    ['a product id that is not a UUID', { ...VALID, lines: [{ ...LINE, productId: 'x' }] }],
    ['a quantity in text', { ...VALID, lines: [{ ...LINE, quantityMilli: '3275' }] }],
    ['a quantity of zero', { ...VALID, lines: [{ ...LINE, quantityMilli: 0 }] }],
    ['a negative quantity', { ...VALID, lines: [{ ...LINE, quantityMilli: -1 }] }],
    ['a fractional quantity', { ...VALID, lines: [{ ...LINE, quantityMilli: 1.5 }] }],
    ['a quantity too large to be exact', { ...VALID, lines: [{ ...LINE, quantityMilli: 2 ** 53 }] }],
    ['a total in text', { ...VALID, expectedTotalCents: '4094' }],
    ['a total of zero', { ...VALID, expectedTotalCents: 0 }],
    ['a negative total', { ...VALID, expectedTotalCents: -1 }],
    ['a fractional total', { ...VALID, expectedTotalCents: 40.94 }],
  ])('refuses %s', (_case, value) => {
    expect(() => parsePendingSaleRequest(value)).toThrow(TypeError);
  });
});

describe('parseSaleId', () => {
  it('returns a valid id', () => {
    expect(parseSaleId(PRODUCT_ID)).toBe(PRODUCT_ID);
  });

  it.each([[undefined], [5], ['abc']])('refuses %s', (value) => {
    expect(() => parseSaleId(value)).toThrow(TypeError);
  });

  it('refuses a UUID that is not version 7', () => {
    expect(() => parseSaleId(KEY)).toThrow(TypeError);
  });
});

describe('parsePaymentRequest', () => {
  const TRANSFER = { amountCents: 4000, reference: 'SPEI-778812' };
  const PAYMENT = { saleId: PRODUCT_ID, cashReceivedCents: 6000, transfers: [TRANSFER] };

  it('returns a valid request, and keeps only the fields it knows', () => {
    expect(parsePaymentRequest({ ...PAYMENT, status: 'completed' })).toEqual(PAYMENT);
  });

  it('accepts a sale with no cash and a sale with no transfer', () => {
    expect(parsePaymentRequest({ ...PAYMENT, cashReceivedCents: 0 }).cashReceivedCents).toBe(0);
    expect(parsePaymentRequest({ ...PAYMENT, transfers: [] }).transfers).toEqual([]);
  });

  it.each([
    ['nothing', undefined],
    ['a sale id that is not a UUIDv7', { ...PAYMENT, saleId: crypto.randomUUID() }],
    ['cash in text', { ...PAYMENT, cashReceivedCents: '6000' }],
    ['negative cash', { ...PAYMENT, cashReceivedCents: -1 }],
    ['fractional cash', { ...PAYMENT, cashReceivedCents: 60.5 }],
    ['transfers that are not a list', { ...PAYMENT, transfers: 'x' }],
    ['too many transfers', { ...PAYMENT, transfers: Array.from({ length: MAX_TRANSFERS + 1 }, () => TRANSFER) }],
    ['a transfer that is not an object', { ...PAYMENT, transfers: [null] }],
    ['a transfer for zero', { ...PAYMENT, transfers: [{ ...TRANSFER, amountCents: 0 }] }],
    ['a transfer with decimals', { ...PAYMENT, transfers: [{ ...TRANSFER, amountCents: 40.5 }] }],
    ['a reference that is not text', { ...PAYMENT, transfers: [{ ...TRANSFER, reference: 5 }] }],
    ['a reference that is too long', { ...PAYMENT, transfers: [{ ...TRANSFER, reference: 'x'.repeat(MAX_REFERENCE_LENGTH + 1) }] }],
  ])('refuses %s', (_case, value) => {
    expect(() => parsePaymentRequest(value)).toThrow(TypeError);
  });
});