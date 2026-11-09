import { describe, expect, it } from 'vitest';

import { formatQuantity, formatSaleMoment, formatSignedCents, formatTaxLabel } from './format';

describe('formatSignedCents', () => {
  it('shows positive and zero amounts like formatCents, and negative ones with a minus sign', () => {
    expect(formatSignedCents(3500)).toBe('$35.00');
    expect(formatSignedCents(0)).toBe('$0.00');
    expect(formatSignedCents(-3500)).toBe('−$35.00');
  });
});

describe('formatSaleMoment', () => {
  it('shows the date and the time of the register', () => {
    const moment = new Date(2026, 10, 8, 14, 5).toISOString();

    const text = formatSaleMoment(moment);

    expect(text).toMatch(/^8 nov 2026/);
    expect(text).toContain('2:05');
  });
});

describe('formatQuantity', () => {
  it.each([
    [3000, 'piece', '3 pza'],
    [3275, 'meter', '3.275 m'],
    [125, 'kilogram', '0.125 kg'],
    [1000, 'liter', '1.000 L'],
  ] as const)('shows %i thousandths of %s as %s', (milli, unit, expected) => {
    expect(formatQuantity({ milli, unit })).toBe(expected);
  });
});

describe('formatTaxLabel', () => {
  it.each([
    ['rate', 1600, 'IVA 16%'],
    ['rate', 800, 'IVA 8%'],
    ['rate', 0, 'IVA 0%'],
    ['rate', 1050, 'IVA 10.5%'],
    ['rate', 1625, 'IVA 16.25%'],
    ['exempt', 0, 'Exento'],
  ] as const)('names %s at %i basis points as %s', (factor, rateBp, expected) => {
    expect(formatTaxLabel({ factor, rateBp })).toBe(expected);
  });
});

describe('formatSignedCents', () => {
  it('shows positive and zero amounts like formatCents, and negative ones with a minus sign', () => {
    expect(formatSignedCents(3500)).toBe('$35.00');
    expect(formatSignedCents(0)).toBe('$0.00');
    expect(formatSignedCents(-3500)).toBe('−$35.00');
  });
});
