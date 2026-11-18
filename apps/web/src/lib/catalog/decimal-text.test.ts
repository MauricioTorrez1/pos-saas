import { describe, expect, it } from 'vitest';
import { formatPrice, formatQuantity, isZeroAmount, parseDecimalInput, parsePercentInput } from './decimal-text';

describe('parseDecimalInput', () => {
  it('reads what people type into fixed-scale text without floats', () => {
    expect(parseDecimalInput('125.5', 4)).toBe('125.5000');
    expect(parseDecimalInput('$1,234.50', 4)).toBe('1234.5000');
    expect(parseDecimalInput(' 12 ', 4)).toBe('12.0000');
    expect(parseDecimalInput('0.1', 4)).toBe('0.1000');
    expect(parseDecimalInput('007', 3)).toBe('7.000');
  });

  it('keeps a price that a float would round', () => {
    expect(parseDecimalInput('0.3', 4)).toBe('0.3000');
    expect(parseDecimalInput('123456789.9999', 4)).toBe('123456789.9999');
  });

  it('refuses more decimals than the scale, negatives and text', () => {
    expect(parseDecimalInput('1.23456', 4)).toBeNull();
    expect(parseDecimalInput('-5', 4)).toBeNull();
    expect(parseDecimalInput('doce', 4)).toBeNull();
    expect(parseDecimalInput('', 4)).toBeNull();
    expect(parseDecimalInput('1e3', 4)).toBeNull();
  });
});

describe('isZeroAmount', () => {
  it('tells zero apart', () => {
    expect(isZeroAmount('0.0000')).toBe(true);
    expect(isZeroAmount('0')).toBe(true);
    expect(isZeroAmount('0.0010')).toBe(false);
  });
});

describe('formatPrice', () => {
  it('shows pesos with two decimals and thousands separators', () => {
    expect(formatPrice('1234.5000')).toBe('$1,234.50');
    expect(formatPrice('116.0000')).toBe('$116.00');
    expect(formatPrice('0.0000')).toBe('$0.00');
  });

  it('keeps the tenths of a cent of a price by the meter', () => {
    expect(formatPrice('12.3450')).toBe('$12.345');
    expect(formatPrice('0.0001')).toBe('$0.0001');
  });

  it('leaves text it does not understand', () => {
    expect(formatPrice('n/a')).toBe('n/a');
  });
});

describe('formatQuantity', () => {
  it('drops trailing zeros', () => {
    expect(formatQuantity('100.000')).toBe('100');
    expect(formatQuantity('0.250')).toBe('0.25');
    expect(formatQuantity('12')).toBe('12');
  });
});

describe('parsePercentInput', () => {
  it('reads raises and cuts with up to two decimals', () => {
    expect(parsePercentInput('5')).toBe('5');
    expect(parsePercentInput('-2.5')).toBe('-2.5');
    expect(parsePercentInput('+10 %')).toBe('10');
    expect(parsePercentInput('007.25')).toBe('7.25');
  });

  it('refuses zero, a cut of 100% or more, and three decimals', () => {
    expect(parsePercentInput('0')).toBeNull();
    expect(parsePercentInput('-100')).toBeNull();
    expect(parsePercentInput('1.234')).toBeNull();
    expect(parsePercentInput('cinco')).toBeNull();
  });
});
