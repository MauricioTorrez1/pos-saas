import type { ChangePriceRequest } from '../../shared/pricing';

const UUID_V7_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_PIN_LENGTH = 8;

function requireWholeNumber(value: unknown, description: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Expected ${description} as a whole number of ten-thousandths`);
  }
  return value;
}

/**
 * Checks a price change that came over the bridge. The service checks the rules of the business, such as the limits of the
 * price and who may approve; this checks the shape.
 *
 * @param value what the screen sent
 * @returns the request, with only the fields it knows
 * @throws TypeError if something is missing or has the wrong type
 */
export function parseChangePriceRequest(value: unknown): ChangePriceRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Expected a price change');
  }
  const request = value as Record<string, unknown>;
  if (typeof request.productId !== 'string' || !UUID_V7_TEXT.test(request.productId)) {
    throw new TypeError('Expected the UUIDv7 of a product');
  }
  const { ownerPin } = request;
  if (ownerPin !== undefined && (typeof ownerPin !== 'string' || ownerPin.length > MAX_PIN_LENGTH)) {
    throw new TypeError(`Expected the PIN of the owner as text of at most ${MAX_PIN_LENGTH} characters`);
  }
  return {
    productId: request.productId,
    previousUnitPriceE4: requireWholeNumber(request.previousUnitPriceE4, 'the price the screen saw'),
    newUnitPriceE4: requireWholeNumber(request.newUnitPriceE4, 'the new price'),
    ...(ownerPin === undefined ? {} : { ownerPin }),
  };
}
