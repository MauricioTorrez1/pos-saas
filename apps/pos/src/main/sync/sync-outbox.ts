import type { StatementSync } from 'node:sqlite';

import type { LocalStore } from '../local-store/local-store';
import { uuidV7 } from '../uuid-v7';
import { SYNC_SCHEMA_VERSION, type SyncOperation, type SyncOperationType, type SyncResultStatus } from './sync-protocol';

/** An operation that has not been confirmed by the core yet. */
export interface PendingOperation extends SyncOperation {
  /** How many pushes already failed to confirm it. */
  readonly attempts: number;
}

/** What the outbox holds, counted by state. */
export interface OutboxCounts {
  readonly pending: number;
  readonly delivered: number;
  readonly quarantined: number;
}

interface OutboxRowSql {
  readonly device_seq: number;
  readonly op_id: string;
  readonly type: SyncOperationType;
  readonly schema_version: number;
  readonly occurred_at: string;
  readonly payload: string;
  readonly attempts: number;
}

/** The core's confirmation of one operation. */
export interface DeliveryConfirmation {
  readonly opId: string;
  readonly status: SyncResultStatus;
}

/**
 * The queue of what the core still has to hear about. `enqueue` is called inside the transaction of the change it
 * describes, so both commit or both vanish. Everything else belongs to the synchronizer (ADR 0040).
 */
export class SyncOutbox {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  readonly #insert: StatementSync;
  readonly #pending: StatementSync;
  readonly #markDelivered: StatementSync;
  readonly #markFailed: StatementSync;
  readonly #counts: StatementSync;

  /**
   * @param store the open local database
   * @param tenantId the business whose operations this outbox holds
   */
  constructor(store: LocalStore, tenantId: string) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#insert = store.prepare(`
      INSERT INTO sync_outbox (op_id, tenant_id, type, schema_version, occurred_at, payload) VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.#pending = store.prepare(`
      SELECT device_seq, op_id, type, schema_version, occurred_at, payload, attempts FROM sync_outbox
      WHERE tenant_id = ? AND status = 'pending' ORDER BY device_seq LIMIT ?
    `);
    this.#markDelivered = store.prepare(`
      UPDATE sync_outbox SET status = 'delivered', server_status = ?, delivered_at = ?, last_error = NULL
      WHERE tenant_id = ? AND op_id = ? AND status = 'pending'
    `);
    this.#markFailed = store.prepare(`
      UPDATE sync_outbox SET attempts = attempts + 1, last_error = ?, last_attempt_at = ?
      WHERE tenant_id = ? AND op_id = ? AND status = 'pending'
    `);
    this.#counts = store.prepare(`
      SELECT
        coalesce(sum(status = 'pending'), 0) AS pending,
        coalesce(sum(status = 'delivered'), 0) AS delivered,
        coalesce(sum(server_status = 'quarantined'), 0) AS quarantined
      FROM sync_outbox WHERE tenant_id = ?
    `);
  }

  /**
   * Queues an operation. It must run inside the transaction of the change it describes, which is what keeps a sale and
   * its operation from ever existing apart. It throws if called outside one, because then the guarantee would be gone.
   *
   * @param type what happened
   * @param payload what the core needs to know, following the contract of that type
   * @param occurredAt when it happened, informative only
   * @returns the idempotency key of the operation
   * @throws Error if no transaction is open
   */
  enqueue(type: SyncOperationType, payload: Readonly<Record<string, unknown>>, occurredAt: string = new Date().toISOString()): string {
    if (!this.#store.isInTransaction) {
      throw new Error('An operation must be queued inside the transaction of the change it describes');
    }
    const opId = uuidV7();
    this.#insert.run(opId, this.#tenantId, type, SYNC_SCHEMA_VERSION, occurredAt, JSON.stringify(payload));
    return opId;
  }

  /**
   * Reads the oldest operations that the core has not confirmed, in the order they happened.
   *
   * @param limit how many to read at most
   * @returns them in ascending `deviceSeq`
   */
  pending(limit: number): PendingOperation[] {
    const rows = this.#pending.all(this.#tenantId, limit) as unknown as OutboxRowSql[];
    return rows.map((row) => ({
      opId: row.op_id,
      deviceSeq: row.device_seq,
      type: row.type,
      schemaVersion: row.schema_version,
      occurredAt: row.occurred_at,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      attempts: row.attempts,
    }));
  }

  /**
   * Marks as delivered only the operations the core confirmed, all in one transaction. One that is already delivered is
   * left alone, so confirming twice is harmless.
   *
   * @param confirmations what the core said about each operation
   * @returns how many operations changed state
   */
  markDelivered(confirmations: readonly DeliveryConfirmation[]): number {
    const deliveredAt = new Date().toISOString();
    return this.#store.transaction(() => {
      let changed = 0;
      for (const { opId, status } of confirmations) {
        changed += Number(this.#markDelivered.run(status, deliveredAt, this.#tenantId, opId).changes);
      }
      return changed;
    });
  }

  /**
   * Notes that a push did not confirm these operations. They stay pending and keep their place.
   *
   * @param opIds the operations that were sent without a confirmation
   * @param error why, for whoever looks at the outbox
   */
  markFailed(opIds: readonly string[], error: string): void {
    const attemptedAt = new Date().toISOString();
    this.#store.transaction(() => {
      for (const opId of opIds) {
        this.#markFailed.run(error.slice(0, 500), attemptedAt, this.#tenantId, opId);
      }
    });
  }

  /**
   * Counts the operations by state.
   *
   * @returns how many are waiting, how many were confirmed, and how many of those the core quarantined
   */
  counts(): OutboxCounts {
    return this.#counts.get(this.#tenantId) as unknown as OutboxCounts;
  }
}
