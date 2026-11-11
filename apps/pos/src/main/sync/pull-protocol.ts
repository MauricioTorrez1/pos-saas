import type { TaxFactor, Unit } from '@pos-saas/money';

import { SyncProtocolError } from './sync-protocol';

/** The most changes the core sends in one page. */
export const MAX_PULL_PAGE_SIZE = 500;

/** The cursor of a register that has never pulled. */
export const INITIAL_CURSOR = '0';

const CURSOR_PATTERN = /^(0|[1-9][0-9]{0,15})$/;
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UNITS: readonly string[] = ['piece', 'meter', 'kilogram', 'liter'];
const TAX_FACTORS: readonly string[] = ['rate', 'exempt'];
const ROLES: readonly string[] = ['owner', 'manager', 'cashier'];
const PERMISSION_ID = /^[a-z]+(\.[a-z]+)+$/;

/** A product with its price, as the core publishes it. Its id is the `entityId` of the change. */
export interface ProductState {
  readonly name: string;
  readonly baseUnit: Unit;
  readonly unitPriceE4: number;
  readonly taxFactor: TaxFactor;
  readonly taxRateBp: number;
  readonly barcodes: readonly string[];
}

/** A person and what the register lets them do. Its id is the `entityId` of the change. */
export interface StaffMemberState {
  readonly displayName: string;
  readonly role: 'owner' | 'manager' | 'cashier';
  readonly permissions: readonly string[];
  readonly active: boolean;
}

/** One change of the feed of the core. A deletion has no state: it is a tombstone. */
export type PullChange =
  | { readonly seq: number; readonly entityType: 'product'; readonly entityId: string; readonly deleted: false; readonly payload: ProductState }
  | { readonly seq: number; readonly entityType: 'product'; readonly entityId: string; readonly deleted: true }
  | { readonly seq: number; readonly entityType: 'staff_member'; readonly entityId: string; readonly deleted: false; readonly payload: StaffMemberState }
  | { readonly seq: number; readonly entityType: 'staff_member'; readonly entityId: string; readonly deleted: true };

/** One page of the feed. */
export interface PullPage {
  readonly changes: readonly PullChange[];
  /** What to ask for next. The register stores it as received and never computes with it. */
  readonly nextCursor: string;
  /** Whether more changes were waiting when the page was read. */
  readonly hasMore: boolean;
}

function record(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SyncProtocolError(`${where} is not an object`);
  }
  return value as Record<string, unknown>;
}

function integer(value: unknown, where: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new SyncProtocolError(`${where} is not a whole number from ${min} to ${max}`);
  }
  return value;
}

function text(value: unknown, where: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    throw new SyncProtocolError(`${where} is not a text of 1 to ${maxLength} characters`);
  }
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly string[], where: string): T {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new SyncProtocolError(`${where} is not one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function parseProduct(value: unknown): ProductState {
  const body = record(value, 'a product payload');
  const taxFactor = oneOf<TaxFactor>(body.taxFactor, TAX_FACTORS, 'taxFactor');
  const taxRateBp = integer(body.taxRateBp, 'taxRateBp', 0, 10_000);
  if (taxFactor === 'exempt' && taxRateBp !== 0) {
    throw new SyncProtocolError('an exempt product has a rate of 0');
  }
  if (!Array.isArray(body.barcodes) || body.barcodes.length > 20) {
    throw new SyncProtocolError('barcodes is not a list of at most 20 codes');
  }
  const barcodes = body.barcodes.map((code, index) => text(code, `barcode ${index}`, 64));
  if (new Set(barcodes).size !== barcodes.length) {
    throw new SyncProtocolError('barcodes has a repeated code');
  }
  return {
    name: text(body.name, 'name', 200),
    baseUnit: oneOf<Unit>(body.baseUnit, UNITS, 'baseUnit'),
    unitPriceE4: integer(body.unitPriceE4, 'unitPriceE4', 0, Number.MAX_SAFE_INTEGER),
    taxFactor,
    taxRateBp,
    barcodes,
  };
}

function parseStaffMember(value: unknown): StaffMemberState {
  const body = record(value, 'a staff member payload');
  if (!Array.isArray(body.permissions) || body.permissions.length > 64) {
    throw new SyncProtocolError('permissions is not a list of at most 64 permissions');
  }
  const permissions = body.permissions.map((permission, index) => {
    if (typeof permission !== 'string' || !PERMISSION_ID.test(permission)) {
      throw new SyncProtocolError(`permission ${index} is not a permission id`);
    }
    return permission;
  });
  if (typeof body.active !== 'boolean') {
    throw new SyncProtocolError('active is not true or false');
  }
  return {
    displayName: text(body.displayName, 'displayName', 100),
    role: oneOf<StaffMemberState['role']>(body.role, ROLES, 'role'),
    permissions,
    active: body.active,
  };
}

function parseChange(value: unknown, index: number): PullChange {
  const where = `change ${index}`;
  const body = record(value, where);
  const seq = integer(body.seq, `${where} seq`, 1, Number.MAX_SAFE_INTEGER);
  const entityType = oneOf<'product' | 'staff_member'>(body.entityType, ['product', 'staff_member'], `${where} entityType`);
  if (typeof body.entityId !== 'string' || !UUID_V7.test(body.entityId)) {
    throw new SyncProtocolError(`${where} has an entityId that is not a UUIDv7`);
  }
  if (body.schemaVersion !== 1) {
    throw new SyncProtocolError(`${where} has a schemaVersion this register does not know`);
  }
  if (typeof body.deleted !== 'boolean') {
    throw new SyncProtocolError(`${where} has no deleted flag`);
  }
  const entityId = body.entityId;
  if (body.deleted) {
    if ('payload' in body) {
      throw new SyncProtocolError(`${where} is a deletion and still has a payload`);
    }
    return { seq, entityType, entityId, deleted: true };
  }
  return entityType === 'product'
    ? { seq, entityType, entityId, deleted: false, payload: parseProduct(body.payload) }
    : { seq, entityType, entityId, deleted: false, payload: parseStaffMember(body.payload) };
}

/**
 * Checks a page from the core against the pull contract before the register applies any of it. A page that is misread
 * would write wrong prices, so one bad change makes the whole page unusable, and an unknown kind of entity does too:
 * skipping it would lose it for good once the cursor moves past it.
 *
 * @param body the parsed JSON of the answer
 * @returns the same page, now typed
 * @throws SyncProtocolError if the shape, a value, or the order of the changes is wrong
 */
export function parsePullResponse(body: unknown): PullPage {
  const page = record(body, 'the answer');
  if (!Array.isArray(page.changes) || page.changes.length > MAX_PULL_PAGE_SIZE) {
    throw new SyncProtocolError(`it has no list of at most ${MAX_PULL_PAGE_SIZE} changes`);
  }
  if (typeof page.nextCursor !== 'string' || !CURSOR_PATTERN.test(page.nextCursor)) {
    throw new SyncProtocolError('its nextCursor is not a cursor');
  }
  if (typeof page.hasMore !== 'boolean') {
    throw new SyncProtocolError('it does not say whether there is more');
  }
  const changes = page.changes.map(parseChange);
  changes.forEach((change, index) => {
    if (index > 0 && change.seq <= changes[index - 1]!.seq) {
      throw new SyncProtocolError('its changes are not in ascending order');
    }
  });
  const last = changes.at(-1);
  if (last !== undefined && page.nextCursor !== String(last.seq)) {
    throw new SyncProtocolError('its nextCursor is not the number of its last change');
  }
  return { changes, nextCursor: page.nextCursor, hasMore: page.hasMore };
}

/**
 * Tells whether one cursor is behind another, comparing them as numbers without ever losing digits.
 *
 * @param cursor a cursor
 * @param other another cursor
 * @returns true if `cursor` is strictly lower
 */
export function isCursorBehind(cursor: string, other: string): boolean {
  return BigInt(cursor) < BigInt(other);
}
