import type { LocalStore } from '../local-store/local-store';
import { uuidV7 } from '../uuid-v7';

const SETTING_NAME = 'register_id';

/**
 * Gives this register the id it uses with the core. It is made once, on first use, and kept in the local database. A
 * register has no enrollment until F0-15, so the core does not check it yet; enrolling replaces it with the issued id.
 *
 * @param store the open local database
 * @param tenantId the business the register belongs to
 * @returns the same UUIDv7 every time for this database
 */
export function registerIdOf(store: LocalStore, tenantId: string): string {
  return store.transaction(() => {
    store
      .prepare('INSERT INTO register_setting (tenant_id, name, value) VALUES (?, ?, ?) ON CONFLICT (tenant_id, name) DO NOTHING')
      .run(tenantId, SETTING_NAME, uuidV7());
    const row = store.prepare('SELECT value FROM register_setting WHERE tenant_id = ? AND name = ?').get(tenantId, SETTING_NAME) as unknown as {
      value: string;
    };
    return row.value;
  });
}
