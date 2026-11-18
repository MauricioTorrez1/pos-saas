/**
 * Decimal amounts as text. The core sends and receives prices (4 decimals, ADR 0011), quantities (3 decimals) and
 * percentages (2 decimals) as strings, so the panel never turns them into a `number` and never rounds them.
 */

const DECIMAL_INPUT = /^(\d{1,9})(?:\.(\d*))?$/;

/**
 * Reads what a person types as an amount into fixed-scale text.
 *
 * Accepts a leading `$`, thousands commas and spaces, and a decimal point: `"$1,234.5"` with scale 4 gives
 * `"1234.5000"`.
 *
 * @param input - What the person typed.
 * @param scale - Decimals of the result.
 * @returns The amount with exactly `scale` decimals, or `null` when it is not a non-negative amount with at most
 *   `scale` decimals.
 */
export function parseDecimalInput(input: string, scale: number): string | null {
  const cleaned = input.trim().replace(/^\$/, '').replace(/[\s,]/g, '');
  const match = DECIMAL_INPUT.exec(cleaned);
  if (!match) {
    return null;
  }
  const whole = String(Number.parseInt(match[1] ?? '0', 10));
  const fraction = match[2] ?? '';
  if (fraction.length > scale) {
    return null;
  }
  return scale === 0 ? whole : `${whole}.${fraction.padEnd(scale, '0')}`;
}

/**
 * Tells whether a fixed-scale amount is zero.
 *
 * @param text - An amount such as `"0.0000"`.
 */
export function isZeroAmount(text: string): boolean {
  return /^0+(?:\.0*)?$/.test(text);
}

function groupThousands(whole: string): string {
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Formats a price of the core for the screen: `"1234.5000"` becomes `"$1,234.50"` and `"12.3450"` becomes
 * `"$12.345"`. It keeps at least two decimals and drops only trailing zeros, so a price by the meter with tenths of
 * a cent is shown exactly.
 *
 * @param price - Price text of the core, with up to 4 decimals.
 * @returns The price for people, or the input unchanged when it is not a decimal amount.
 */
export function formatPrice(price: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(price.trim());
  if (!match) {
    return price;
  }
  const [, sign, whole = '0', rawFraction = ''] = match;
  let fraction = rawFraction.padEnd(2, '0');
  while (fraction.length > 2 && fraction.endsWith('0')) {
    fraction = fraction.slice(0, -1);
  }
  return `${sign}$${groupThousands(whole)}.${fraction}`;
}

/**
 * Formats a quantity of the core (3 decimals) without the trailing zeros: `"100.000"` becomes `"100"`, `"0.250"`
 * becomes `"0.25"`.
 *
 * @param quantity - Quantity text of the core.
 */
export function formatQuantity(quantity: string): string {
  if (!/^\d+(?:\.\d+)?$/.test(quantity)) {
    return quantity;
  }
  return quantity.includes('.') ? quantity.replace(/\.?0+$/, '') : quantity;
}

const PERCENT_INPUT = /^([+-]?)(\d{1,3})(?:\.(\d{1,2}))?$/;

/**
 * Reads the percentage of a bulk price change.
 *
 * @param input - What the person typed, such as `"5"`, `"-2.5"` or `"+10 %"`.
 * @returns The percentage as the core expects it (`"5"`, `"-2.5"`), or `null` when it is not a number with up to two
 *   decimals, is zero, or would leave prices at zero or below.
 */
export function parsePercentInput(input: string): string | null {
  const match = PERCENT_INPUT.exec(input.trim().replace(/\s*%$/, '').replace(/\s+/g, ''));
  if (!match) {
    return null;
  }
  const [, sign, whole = '0', fraction = ''] = match;
  const hundredths = Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction.padEnd(2, '0') || '0', 10);
  if (hundredths === 0 || (sign === '-' && hundredths >= 10_000)) {
    return null;
  }
  const normalizedWhole = String(Number.parseInt(whole, 10));
  return `${sign === '-' ? '-' : ''}${normalizedWhole}${fraction ? `.${fraction}` : ''}`;
}
