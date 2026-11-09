import type { ReturnRequest } from '../../shared/returns-api';

const UUID_V7_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** More lines than any ticket at the counter. */
export const MAX_RETURN_LINES = 500;

/** Longest reason a person writes for a return. */
export const MAX_RETURN_REASON_LENGTH = 200;

function requireRecord(value: unknown, description: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`Expected ${description}`);
  }
  return value as Record<string, unknown>;
}

function requireUuid(value: unknown, description: string): string {
  if (typeof value !== 'string' || !UUID_V7_TEXT.test(value)) {
    throw new TypeError(`Expected the UUIDv7 of ${description}`);
  }
  return value;
}

/**
 * Checks the folio that was typed to look for a sale.
 *
 * @param value whatever crossed the bridge
 * @returns the text
 * @throws TypeError if it is not text of at most 20 characters
 */
export function parseFolioText(value: unknown): string {
  if (typeof value !== 'string' || value.length > 20) {
    throw new TypeError('Expected a folio of at most 20 characters');
  }
  return value;
}

/**
 * Checks a return before it is worked out, because the database must not depend on the screen being right.
 *
 * @param value whatever crossed the bridge
 * @returns the return, with only the known fields
 * @throws TypeError if any field is missing or malformed
 */
export function parseReturnRequest(value: unknown): ReturnRequest {
  const request = requireRecord(value, 'a return');
  const { lines, reason, ownerPin, override } = request;
  if (!Array.isArray(lines) || lines.length > MAX_RETURN_LINES) {
    throw new TypeError(`Expected at most ${MAX_RETURN_LINES} lines to return`);
  }
  if (typeof reason !== 'string' || reason.length > MAX_RETURN_REASON_LENGTH) {
    throw new TypeError(`Expected a reason of at most ${MAX_RETURN_REASON_LENGTH} characters`);
  }
  if (ownerPin !== undefined && (typeof ownerPin !== 'string' || ownerPin.length > 8)) {
    throw new TypeError('Expected the PIN of an owner as text of at most 8 characters');
  }
  if (override !== undefined && typeof override !== 'boolean') {
    throw new TypeError('Expected the override as true or false');
  }
  return {
    saleId: requireUuid(request.saleId, 'a sale'),
    lines: lines.map((entry) => {
      const line = requireRecord(entry, 'a line to return');
      const { quantityMilli } = line;
      if (typeof quantityMilli !== 'number' || !Number.isSafeInteger(quantityMilli) || quantityMilli < 0) {
        throw new TypeError('Expected a quantity in thousandths as a whole number');
      }
      return { saleLineId: requireUuid(line.saleLineId, 'a sale line'), quantityMilli };
    }),
    reason,
    ...(ownerPin === undefined ? {} : { ownerPin }),
    ...(override === undefined ? {} : { override }),
  };
}
