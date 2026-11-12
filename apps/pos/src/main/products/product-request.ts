import { isUnit } from '@pos-saas/money';

import { MAX_BARCODES_PER_PRODUCT, type NewProductRequest } from '../../shared/product-admin';

const MAX_PIN_LENGTH = 8;
/** A text longer than this is not a name or a barcode, so it is refused before anything looks at it. */
const MAX_TEXT_LENGTH = 1000;

function asRecord(value: unknown, description: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`Expected ${description}`);
  }
  return value as Record<string, unknown>;
}

function requireText(value: unknown, description: string): string {
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) {
    throw new TypeError(`Expected ${description} as text of at most ${MAX_TEXT_LENGTH} characters`);
  }
  return value;
}

function requireInteger(value: unknown, description: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Expected ${description} as a whole number of zero or more`);
  }
  return value;
}

/**
 * Checks the PIN of an owner that came over the bridge.
 *
 * @param value what the screen sent, or undefined when nobody typed a PIN
 * @returns the PIN, or undefined
 * @throws TypeError if it is not text of at most eight characters
 */
export function parseOwnerPin(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.length > MAX_PIN_LENGTH) {
    throw new TypeError(`Expected the PIN of the owner as text of at most ${MAX_PIN_LENGTH} characters`);
  }
  return value;
}

/**
 * Checks the list of barcodes that came over the bridge.
 *
 * @param value what the screen sent
 * @returns the codes
 * @throws TypeError if it is not a list of texts
 */
export function parseBarcodeList(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_BARCODES_PER_PRODUCT + 1) {
    throw new TypeError('Expected a list of barcodes');
  }
  return value.map((code) => requireText(code, 'a barcode'));
}

/**
 * Checks a new product that came over the bridge. The service checks the rules of the business, such as the limits of the
 * price and who may approve; this checks the shape.
 *
 * @param value what the screen sent
 * @returns the request, with only the fields it knows
 * @throws TypeError if something is missing or has the wrong type
 */
export function parseNewProductRequest(value: unknown): NewProductRequest {
  const request = asRecord(value, 'a new product');
  const taxRate = asRecord(request.taxRate, 'the VAT rate');
  if (taxRate.factor !== 'rate' && taxRate.factor !== 'exempt') {
    throw new TypeError('Expected the VAT factor to be rate or exempt');
  }
  if (!isUnit(request.unit)) {
    throw new TypeError('Expected the unit to be piece, meter, kilogram or liter');
  }
  if (typeof request.isActive !== 'boolean') {
    throw new TypeError('Expected whether the product is active');
  }
  const ownerPin = parseOwnerPin(request.ownerPin);
  return {
    name: requireText(request.name, 'the name'),
    unit: request.unit,
    unitPriceE4: requireInteger(request.unitPriceE4, 'the price'),
    taxRate: { factor: taxRate.factor, rateBp: requireInteger(taxRate.rateBp, 'the VAT rate') },
    unitCostE6: request.unitCostE6 === null ? null : requireInteger(request.unitCostE6, 'the cost'),
    barcodes: parseBarcodeList(request.barcodes),
    initialStockMilli: request.initialStockMilli === null ? null : requireInteger(request.initialStockMilli, 'the initial stock'),
    isActive: request.isActive,
    ...(ownerPin === undefined ? {} : { ownerPin }),
  };
}
