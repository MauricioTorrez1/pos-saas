import type { PendingSaleRequest } from '../../shared/pos-api';

/** More lines than any ticket at the counter, so a broken screen cannot make one request hold the main process. */
export const MAX_SALE_LINES = 500;

/** Any UUID, in the lower case that `crypto.randomUUID` produces. */
const UUID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const UUID_V7_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function requireMatch(value: unknown, pattern: RegExp, description: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new TypeError(`Expected ${description}`);
  }
  return value;
}

function requirePositiveInteger(value: unknown, description: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`Expected ${description} as a positive integer`);
  }
  return value;
}

function requireRecord(value: unknown, description: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`Expected ${description}`);
  }
  return value as Record<string, unknown>;
}

function parseLine(value: unknown): PendingSaleRequest['lines'][number] {
  const line = requireRecord(value, 'a sale line');
  return {
    productId: requireMatch(line.productId, UUID_V7_TEXT, 'the UUIDv7 of a product'),
    quantityMilli: requirePositiveInteger(line.quantityMilli, 'a quantity in thousandths'),
  };
}

function parseLines(value: unknown): PendingSaleRequest['lines'] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SALE_LINES) {
    throw new TypeError(`Expected between 1 and ${MAX_SALE_LINES} sale lines`);
  }
  return value.map(parseLine);
}

/**
 * Checks what the screen sent, because the database must not depend on the screen being right.
 *
 * @param value whatever crossed the bridge
 * @returns a request with only the known fields
 * @throws TypeError if any field is missing or malformed
 */
export function parsePendingSaleRequest(value: unknown): PendingSaleRequest {
  const request = requireRecord(value, 'a sale request');
  return {
    idempotencyKey: requireMatch(request.idempotencyKey, UUID_TEXT, 'a UUID as the idempotency key'),
    lines: parseLines(request.lines),
    expectedTotalCents: requirePositiveInteger(request.expectedTotalCents, 'a total in cents'),
  };
}

/**
 * Checks the id of a sale that crossed the bridge.
 *
 * @param value whatever the screen sent
 * @returns the id
 * @throws TypeError if it is not a UUIDv7
 */
export function parseSaleId(value: unknown): string {
  return requireMatch(value, UUID_V7_TEXT, 'the UUIDv7 of a sale');
}
