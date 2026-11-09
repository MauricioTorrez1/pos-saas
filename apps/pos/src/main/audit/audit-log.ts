import type { StatementSync } from 'node:sqlite';

import type { LocalStore } from '../local-store/local-store';
import { uuidV7 } from '../uuid-v7';

/** Something worth remembering about who did what. */
export interface AuditEntry {
  readonly userId: string;
  /** What was done, such as `stock.adjust` or `sale.misc_item`. */
  readonly action: string;
  readonly entity: string;
  readonly entityId: string;
  /** The values and the reason, in plain text, so a person can read them later. */
  readonly detail: string;
}

/** The audit log: only added to, never edited or deleted (RF-040). */
export class AuditLog {
  readonly #tenantId: string;
  readonly #insert: StatementSync;

  /**
   * @param store the open local database
   * @param tenantId the business whose log this is
   */
  constructor(store: LocalStore, tenantId: string) {
    this.#tenantId = tenantId;
    this.#insert = store.prepare(`
      INSERT INTO audit_log (id, tenant_id, user_id, action, entity, entity_id, detail, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  /**
   * Adds an entry. Inside a transaction it commits or rolls back with what it describes, so a change never lacks its entry.
   *
   * @param entry what happened
   */
  record(entry: AuditEntry): void {
    this.#insert.run(uuidV7(), this.#tenantId, entry.userId, entry.action, entry.entity, entry.entityId, entry.detail, new Date().toISOString());
  }
}
