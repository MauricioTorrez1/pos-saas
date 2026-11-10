/**
 * The product id every miscellaneous item is recorded under. It is not in the catalog and has no stock: selling it never
 * moves the ledger (ADR 0033).
 */
export const MISC_PRODUCT_ID = '00000000-0000-7000-8000-000000000000';

/** What the screen puts in front of the id of a miscellaneous line, so two of them never merge into one line. */
export const MISC_LINE_ID_PREFIX = 'misc:';

/** VAT of a miscellaneous item, in basis points: the usual 16% already included in the price. */
export const MISC_TAX_RATE_BP = 1600;

/** Longer than any description that fits on a ticket line. */
export const MAX_MISC_NAME_LENGTH = 60;

/**
 * Tells whether a line of the sale on the screen is a miscellaneous item.
 *
 * @param lineId the id the screen gives the product of the line
 * @returns true for a miscellaneous item
 */
export function isMiscLineId(lineId: string): boolean {
  return lineId.startsWith(MISC_LINE_ID_PREFIX);
}
