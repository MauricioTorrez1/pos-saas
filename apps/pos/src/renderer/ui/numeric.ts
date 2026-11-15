/** What a box for numbers accepts: digits with one decimal point, or digits only. */
export type NumericKind = 'decimal' | 'integer';

/**
 * Keeps only what a number is made of, so a box for an amount, a quantity or a PIN never holds letters. A scanner that
 * lands in the wrong box, or a hand on the wrong keys, leaves nothing behind. Commas are dropped, so 1,250.50 pasted
 * from a spreadsheet becomes 1250.50, and only the first decimal point stays.
 *
 * @param text what was typed or pasted
 * @param kind whether a decimal point is allowed
 * @returns the text with everything else removed
 */
export function keepNumeric(text: string, kind: NumericKind): string {
  if (kind === 'integer') {
    return text.replace(/\D/gu, '');
  }
  const cleaned = text.replace(/[^\d.]/gu, '');
  const point = cleaned.indexOf('.');
  return point === -1 ? cleaned : `${cleaned.slice(0, point + 1)}${cleaned.slice(point + 1).replace(/\./gu, '')}`;
}
