import { describe, expect, it } from 'vitest';

import type { CatalogProduct } from '../../shared/pos-api';
import { needsMeasuring, readQuantity, TYPICAL_MAX_MILLI } from './quantity-entry';

function product(unit: CatalogProduct['unit'], unitPriceE4: number): CatalogProduct {
  return { id: 'p', name: 'Producto', unit, unitPriceE4, taxRate: { factor: 'rate', rateBp: 1600 } };
}

const CABLE = product('meter', 125_000);
const NAILS = product('kilogram', 450_000);

describe('needsMeasuring', () => {
  it('asks for the quantity of what is sold by weight, length, or volume, and not of pieces', () => {
    expect(needsMeasuring(product('piece', 1))).toBe(false);
    expect(needsMeasuring(CABLE)).toBe(true);
    expect(needsMeasuring(NAILS)).toBe(true);
    expect(needsMeasuring(product('liter', 1))).toBe(true);
  });
});

describe('readQuantity', () => {
  it('shows the amount of the line before it is added: 3.275 m at $12.50 is $40.94 (RF-012)', () => {
    expect(readQuantity('3.275', CABLE)).toEqual({
      status: 'ok',
      quantity: { milli: 3275, unit: 'meter' },
      amountCents: 4094,
      needsConfirmation: false,
    });
  });

  it('reads whole numbers and numbers that start with a point', () => {
    expect(readQuantity('3', CABLE)).toMatchObject({ status: 'ok', quantity: { milli: 3000 } });
    expect(readQuantity('.5', NAILS)).toMatchObject({ status: 'ok', quantity: { milli: 500 }, amountCents: 2250 });
  });

  it('waits while nothing is typed', () => {
    expect(readQuantity('', CABLE)).toEqual({ status: 'empty' });
    expect(readQuantity('   ', CABLE)).toEqual({ status: 'empty' });
  });

  it.each([['abc'], ['1,5'], ['-2'], ['1e3'], ['3.2755'], ['0'], ['0.000']])('refuses %j with a message', (text) => {
    const reading = readQuantity(text, CABLE);

    expect(reading.status).toBe('invalid');
    expect(reading.status === 'invalid' && reading.message.length > 0).toBe(true);
  });

  it('tells apart a quantity with too many decimals from text that is not a number', () => {
    expect(readQuantity('3.2755', CABLE)).toMatchObject({ message: expect.stringContaining('3 decimales') });
    expect(readQuantity('abc', CABLE)).toMatchObject({ message: expect.stringContaining('Escribe la cantidad') });
  });

  it('asks the cashier to confirm what is more than a shop sells at once, so 125 is not taken for 1.25 (E1-08)', () => {
    expect(readQuantity('125', NAILS)).toMatchObject({ status: 'ok', needsConfirmation: true, amountCents: 562_500 });
    expect(readQuantity('1.25', NAILS)).toMatchObject({ status: 'ok', needsConfirmation: false });
  });

  it('does not ask about the limit itself, but asks about one thousandth more', () => {
    const limit = TYPICAL_MAX_MILLI.kilogram / 1000;

    expect(readQuantity(String(limit), NAILS)).toMatchObject({ needsConfirmation: false });
    expect(readQuantity(`${limit}.001`, NAILS)).toMatchObject({ needsConfirmation: true });
  });

  it('refuses an amount that passes the largest the register handles', () => {
    expect(readQuantity('9007199254740', CABLE)).toMatchObject({ status: 'invalid', message: expect.stringContaining('demasiado grande') });
  });

  it('does not take the barcode of a scan for a quantity that can be added without asking', () => {
    const reading = readQuantity('2000000000107', CABLE);

    expect(reading.status === 'invalid' || (reading.status === 'ok' && reading.needsConfirmation)).toBe(true);
  });
});
