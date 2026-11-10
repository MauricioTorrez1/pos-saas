import { MAX_MISC_NAME_LENGTH } from '../../shared/miscellaneous';
import type { PaymentRequest, PendingSaleRequest } from '../../shared/pos-api';

/** More lines than any ticket at the counter, so a broken screen cannot make one request hold the main process. */
export const MAX_SALE_LINES = 500;

/** More transfers than a sale ever has, so a broken screen cannot make one request hold the main process. */
export const MAX_TRANSFERS = 10;

/** Longer than any bank reference. */
export const MAX_REFERENCE_LENGTH = 60;

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
  if (line.miscellaneous !== undefined) {
    const item = requireRecord(line.miscellaneous, 'a miscellaneous item');
    if (typeof item.name !== 'string' || item.name.trim() === '' || item.name.length > MAX_MISC_NAME_LENGTH) {
      throw new TypeError(`Expected a description of at most ${MAX_MISC_NAME_LENGTH} characters`);
    }
    return {
      miscellaneous: { name: item.name.trim(), unitPriceE4: requirePositiveInteger(item.unitPriceE4, 'a unit price in ten-thousandths') },
      quantityMilli: requirePositiveInteger(line.quantityMilli, 'a quantity in thousandths'),
    };
  }
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
  const { ownerPin } = request;
  if (ownerPin !== undefined && (typeof ownerPin !== 'string' || ownerPin.length > 8)) {
    throw new TypeError('Expected the PIN of the owner as text of at most 8 characters');
  }
  return {
    idempotencyKey: requireMatch(request.idempotencyKey, UUID_TEXT, 'a UUID as the idempotency key'),
    lines: parseLines(request.lines),
    expectedTotalCents: requirePositiveInteger(request.expectedTotalCents, 'a total in cents'),
    ...(ownerPin === undefined ? {} : { ownerPin }),
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

function requireNonNegativeInteger(value: unknown, description: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Expected ${description} as a non-negative integer`);
  }
  return value;
}

function parseTransfer(value: unknown): PaymentRequest['transfers'][number] {
  const transfer = requireRecord(value, 'a transfer or a card payment');
  const { reference } = transfer;
  if (typeof reference !== 'string' || reference.length > MAX_REFERENCE_LENGTH) {
    throw new TypeError(`Expected a transfer reference of at most ${MAX_REFERENCE_LENGTH} characters`);
  }
  return { amountCents: requirePositiveInteger(transfer.amountCents, 'a transfer amount in cents'), reference };
}

function parseTransfers(value: unknown): PaymentRequest['transfers'] {
  if (!Array.isArray(value) || value.length > MAX_TRANSFERS) {
    throw new TypeError(`Expected at most ${MAX_TRANSFERS} transfers or card payments`);
  }
  return value.map(parseTransfer);
}

/**
 * Checks how the screen says a sale was paid, because the database must not depend on the screen being right.
 *
 * @param value whatever crossed the bridge
 * @returns a request with only the known fields
 * @throws TypeError if any field is missing or malformed
 */
export function parsePaymentRequest(value: unknown): PaymentRequest {
  const request = requireRecord(value, 'a payment request');
  const transfers = parseTransfers(request.transfers);
  return {
    saleId: parseSaleId(request.saleId),
    cashReceivedCents: requireNonNegativeInteger(request.cashReceivedCents, 'the cash received in cents'),
    transfers,
    // Only when the screen sent them, so a request without cards stays the same as before.
    ...(request.cards === undefined ? {} : { cards: parseTransfers(request.cards) }),
  };
}