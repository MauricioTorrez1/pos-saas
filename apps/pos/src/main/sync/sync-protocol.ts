/** The kinds of operation the register sends. The wire shape of each one is in `packages/contracts` (ADR 0040). */
export const SYNC_OPERATION_TYPES = [
  'sale.completed',
  'return.registered',
  'cash_session.opened',
  'cash_movement.recorded',
  'cash_session.closed',
  'stock.adjusted',
  'product.price_changed',
] as const;

/** One of the kinds of operation. */
export type SyncOperationType = (typeof SYNC_OPERATION_TYPES)[number];

/** The version of the payload shapes this build writes. The core rejects a version it does not know. */
export const SYNC_SCHEMA_VERSION = 1;

/** The most operations the core accepts in one push. */
export const MAX_BATCH_SIZE = 100;

/** One operation as it travels to the core. */
export interface SyncOperation {
  /** The idempotency key. The core stores each one once per business. */
  readonly opId: string;
  /** Position in this register's own sequence. The core orders by it and never by the clock. */
  readonly deviceSeq: number;
  readonly type: SyncOperationType;
  readonly schemaVersion: number;
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** The body of `POST /sync/push`. */
export interface SyncPushRequest {
  readonly registerId: string;
  readonly operations: readonly SyncOperation[];
}

/** What the core did with one operation. */
export type SyncResultStatus = 'accepted' | 'duplicate' | 'quarantined';

/** The core's answer for one operation. */
export interface SyncOperationResult {
  readonly opId: string;
  readonly status: SyncResultStatus;
  /** Why it was quarantined. */
  readonly reason?: string;
}

/** The body the core answers with. An operation that is not in `results` has not been confirmed. */
export interface SyncPushResponse {
  readonly results: readonly SyncOperationResult[];
}

const RESULT_STATUSES: readonly string[] = ['accepted', 'duplicate', 'quarantined'];

/** The core answered, but not with what the contract says, so nothing in it can be trusted. */
export class SyncProtocolError extends Error {
  /** @param detail what was wrong with the answer */
  constructor(detail: string) {
    super(`The core's answer does not follow the push contract: ${detail}`);
    this.name = 'SyncProtocolError';
  }
}

/**
 * Checks an answer from the core against the push contract before the register believes it. A confirmation that is
 * misread would mark an operation as delivered when it was not, which is how a sale gets lost.
 *
 * @param body the parsed JSON of the answer
 * @returns the same answer, now typed
 * @throws SyncProtocolError if the shape, a status, or an id is wrong
 */
export function parsePushResponse(body: unknown): SyncPushResponse {
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { results?: unknown }).results)) {
    throw new SyncProtocolError('it has no results list');
  }
  const results = (body as { results: unknown[] }).results.map((entry, index): SyncOperationResult => {
    const { opId, status, reason } = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    if (typeof opId !== 'string' || opId.length === 0) {
      throw new SyncProtocolError(`result ${index} has no opId`);
    }
    if (typeof status !== 'string' || !RESULT_STATUSES.includes(status)) {
      throw new SyncProtocolError(`result ${index} has an unknown status`);
    }
    if (status === 'quarantined' && (typeof reason !== 'string' || reason.length === 0)) {
      throw new SyncProtocolError(`result ${index} is quarantined without a reason`);
    }
    return typeof reason === 'string' ? { opId, status: status as SyncResultStatus, reason } : { opId, status: status as SyncResultStatus };
  });
  return { results };
}
