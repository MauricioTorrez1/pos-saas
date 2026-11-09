import type { AdjustStockRequest } from '../../shared/inventory-api';

const UUID_V7_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_REASON_LENGTH = 200;

/**
 * Checks the id of a product that came over the bridge.
 *
 * @param value what the screen sent
 * @returns the id
 * @throws TypeError if it is not a UUIDv7
 */
export function parseProductId(value: unknown): string {
  if (typeof value !== 'string' || !UUID_V7_TEXT.test(value)) {
    throw new TypeError('Expected the UUIDv7 of a product');
  }
  return value;
}

/**
 * Checks an adjustment that came over the bridge. The service checks the rules of the business; this checks the shape.
 *
 * @param value what the screen sent
 * @returns the request, with only the fields it knows
 * @throws TypeError if something is missing or has the wrong type
 */
export function parseAdjustStockRequest(value: unknown): AdjustStockRequest {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError('Expected an adjustment');
  }
  const request = value as Record<string, unknown>;
  if (request.type !== 'adjustment' && request.type !== 'waste') {
    throw new TypeError('Expected the type of the adjustment');
  }
  if (typeof request.quantityMilli !== 'number' || !Number.isSafeInteger(request.quantityMilli)) {
    throw new TypeError('Expected the quantity as a whole number of thousandths');
  }
  if (typeof request.reason !== 'string' || request.reason.length > MAX_REASON_LENGTH) {
    throw new TypeError(`Expected a reason of at most ${MAX_REASON_LENGTH} characters`);
  }
  return { productId: parseProductId(request.productId), type: request.type, quantityMilli: request.quantityMilli, reason: request.reason };
}
