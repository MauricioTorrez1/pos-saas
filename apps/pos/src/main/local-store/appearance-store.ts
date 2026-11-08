import type { StatementSync } from 'node:sqlite';

import { DEFAULT_APPEARANCE, isAppearance, type Appearance } from '../../shared/appearance';
import type { LocalStore } from './local-store';

interface AppearanceRow {
  readonly business_name: string;
  readonly accent: string;
  readonly text_size: string;
  readonly theme: string;
}

/** Keeps how the owner wants the register to look. */
export class AppearanceStore {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  readonly #read: StatementSync;

  /**
   * @param store the open local database
   * @param tenantId the business this appearance belongs to
   */
  constructor(store: LocalStore, tenantId: string) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#read = store.prepare('SELECT business_name, accent, text_size, theme FROM register_appearance WHERE tenant_id = ?');
  }

  /**
   * Reads the saved appearance.
   *
   * @returns the saved appearance. A row with a value this version does not offer counts as never saved, because a
   * wrong color must not stop the register from opening.
   */
  read(): Appearance {
    const row = this.#read.get(this.#tenantId) as unknown as AppearanceRow | undefined;
    if (row === undefined) {
      return DEFAULT_APPEARANCE;
    }
    const appearance = { businessName: row.business_name, accent: row.accent, textSize: row.text_size, theme: row.theme };
    return isAppearance(appearance) ? appearance : DEFAULT_APPEARANCE;
  }

  /**
   * Saves the appearance, replacing the previous one.
   *
   * @param appearance the new appearance
   * @param now when it changed
   */
  save(appearance: Appearance, now: Date = new Date()): void {
    this.#store.transaction((connection) => {
      connection
        .prepare(`
          INSERT INTO register_appearance (tenant_id, business_name, accent, text_size, theme, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (tenant_id) DO UPDATE SET
            business_name = excluded.business_name,
            accent = excluded.accent,
            text_size = excluded.text_size,
            theme = excluded.theme,
            updated_at = excluded.updated_at
        `)
        .run(this.#tenantId, appearance.businessName, appearance.accent, appearance.textSize, appearance.theme, now.toISOString());
    });
  }
}
