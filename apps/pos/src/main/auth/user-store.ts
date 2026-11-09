import type { StatementSync } from 'node:sqlite';

import type { UserRole, UserSummary } from '../../shared/auth';
import { uuidV7 } from '../uuid-v7';
import type { LocalStore } from '../local-store/local-store';

/** What sign-in needs to know about a user. It is the only place the hash leaves the table. */
export interface UserCredentials extends UserSummary {
  readonly pinHash: string;
  readonly failedAttempts: number;
  /** When the lock ends, in ISO 8601, or null if the user is not locked. */
  readonly lockedUntil: string | null;
}

interface CredentialsRow {
  readonly id: string;
  readonly name: string;
  readonly role: UserRole;
  readonly pin_hash: string;
  readonly failed_attempts: number;
  readonly locked_until: string | null;
}

/** Keeps the people of one business who can sign in at this register. */
export class UserStore {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  readonly #count: StatementSync;
  readonly #list: StatementSync;
  readonly #find: StatementSync;
  readonly #owners: StatementSync;
  readonly #insert: StatementSync;
  readonly #setAttempts: StatementSync;

  /**
   * @param store the open local database
   * @param tenantId the business whose people this store sees
   */
  constructor(store: LocalStore, tenantId: string) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#count = store.prepare('SELECT count(*) AS total FROM app_user WHERE tenant_id = ?');
    this.#list = store.prepare('SELECT id, name, role FROM app_user WHERE tenant_id = ? AND is_active = 1 ORDER BY name');
    this.#find = store.prepare(`
      SELECT id, name, role, pin_hash, failed_attempts, locked_until FROM app_user
      WHERE tenant_id = ? AND id = ? AND is_active = 1
    `);
    this.#owners = store.prepare(`
      SELECT id, name, role, pin_hash, failed_attempts, locked_until FROM app_user
      WHERE tenant_id = ? AND role = 'owner' AND is_active = 1 ORDER BY name
    `);
    this.#insert = store.prepare(`
      INSERT INTO app_user (id, tenant_id, name, role, pin_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.#setAttempts = store.prepare('UPDATE app_user SET failed_attempts = ?, locked_until = ? WHERE tenant_id = ? AND id = ?');
  }

  /**
   * Counts the people, including none.
   *
   * @returns how many active and inactive users the business has
   */
  count(): number {
    return (this.#count.get(this.#tenantId) as unknown as { total: number }).total;
  }

  /**
   * Lists who can sign in.
   *
   * @returns the active users by name
   */
  list(): UserSummary[] {
    return this.#list.all(this.#tenantId) as unknown as UserSummary[];
  }

  /**
   * Adds a person.
   *
   * @param name how they are called at the register
   * @param role what they can do
   * @param pinHash the hash of their PIN, never the PIN
   * @returns the new user
   * @throws Error from SQLite if the name is taken
   */
  create(name: string, role: UserRole, pinHash: string): UserSummary {
    const id = uuidV7();
    this.#store.transaction(() => {
      this.#insert.run(id, this.#tenantId, name, role, pinHash, new Date().toISOString());
    });
    return { id, name, role };
  }

  /**
   * Reads what sign-in needs about a person.
   *
   * @param userId the user
   * @returns their credentials, or null if they do not exist or were deactivated
   */
  find(userId: string): UserCredentials | null {
    const row = this.#find.get(this.#tenantId, userId) as unknown as CredentialsRow | undefined;
    return row === undefined ? null : toCredentials(row);
  }

  /**
   * Reads the owners, for authorizing something that needs their PIN.
   *
   * @returns the active owners
   */
  owners(): UserCredentials[] {
    return (this.#owners.all(this.#tenantId) as unknown as CredentialsRow[]).map(toCredentials);
  }

  /**
   * Saves how many wrong PINs a person has typed in a row, and whether they are locked.
   *
   * @param userId the user
   * @param failedAttempts the wrong PINs in a row
   * @param lockedUntil when the lock ends, in ISO 8601, or null
   */
  saveAttempts(userId: string, failedAttempts: number, lockedUntil: string | null): void {
    this.#store.transaction(() => {
      this.#setAttempts.run(failedAttempts, lockedUntil, this.#tenantId, userId);
    });
  }
}

function toCredentials(row: CredentialsRow): UserCredentials {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    pinHash: row.pin_hash,
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until,
  };
}
