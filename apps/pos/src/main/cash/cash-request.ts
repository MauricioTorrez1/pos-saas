import { DENOMINATIONS_CENTS } from '../../shared/cash';
import type { CashMovementRequest, CloseCashRequest } from '../../shared/cash-api';

/** Longest reason a person writes for a movement or a difference. */
export const MAX_REASON_LENGTH = 200;

function requireRecord(value: unknown, description: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`Expected ${description}`);
  }
  return value as Record<string, unknown>;
}

function requireCents(value: unknown, description: string, minimum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(`Expected ${description} as a whole number of cents of at least ${minimum}`);
  }
  return value;
}

function requireReason(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_REASON_LENGTH) {
    throw new TypeError(`Expected a reason of at most ${MAX_REASON_LENGTH} characters`);
  }
  return value;
}

/**
 * Checks the float the cashier typed.
 *
 * @param value whatever crossed the bridge
 * @returns the float in cents
 * @throws TypeError if it is not a whole non-negative number of cents
 */
export function parseOpenRequest(value: unknown): number {
  return requireCents(requireRecord(value, 'a request to open the register').floatCents, 'the float', 0);
}

/**
 * Checks the limit the owner typed.
 *
 * @param value whatever crossed the bridge
 * @returns the limit in cents
 * @throws TypeError if it is not a positive whole number of cents
 */
export function parseLimitRequest(value: unknown): number {
  return requireCents(requireRecord(value, 'a withdrawal limit').limitCents, 'the limit', 1);
}

/**
 * Checks a cash entry or exit.
 *
 * @param value whatever crossed the bridge
 * @returns the movement, with only the known fields
 * @throws TypeError if any field is missing or malformed
 */
export function parseMovementRequest(value: unknown): CashMovementRequest {
  const request = requireRecord(value, 'a cash movement');
  if (request.kind !== 'in' && request.kind !== 'out') {
    throw new TypeError('Expected a cash entry or exit');
  }
  const { ownerPin } = request;
  if (ownerPin !== undefined && (typeof ownerPin !== 'string' || ownerPin.length > 8)) {
    throw new TypeError('Expected the PIN of an owner as text of at most 8 characters');
  }
  return {
    kind: request.kind,
    amountCents: requireCents(request.amountCents, 'an amount', 1),
    reason: requireReason(request.reason),
    ...(ownerPin === undefined ? {} : { ownerPin }),
  };
}

/**
 * Checks what was counted for a cut.
 *
 * @param value whatever crossed the bridge
 * @returns the count, with only bills and coins that exist
 * @throws TypeError if any field is missing or malformed, or a denomination does not exist
 */
export function parseCloseRequest(value: unknown): CloseCashRequest {
  const request = requireRecord(value, 'a cut');
  const rawCounts = requireRecord(request.counts, 'the count of bills and coins');
  const counts: Record<number, number> = {};
  for (const [denomination, count] of Object.entries(rawCounts)) {
    if (!(DENOMINATIONS_CENTS as readonly number[]).includes(Number(denomination))) {
      throw new TypeError(`${denomination} cents is not a bill or a coin`);
    }
    counts[Number(denomination)] = requireCents(count, `the count of ${denomination}-cent pieces`, 0);
  }
  return {
    counts,
    cardCountedCents: requireCents(request.cardCountedCents, 'the card total', 0),
    transferCountedCents: requireCents(request.transferCountedCents, 'the transfer total', 0),
    reason: requireReason(request.reason),
  };
}
