import type { StatementSync } from 'node:sqlite';

import {
  DEFAULT_KEYMAP,
  DEFAULT_TICKET_DESIGN,
  isKeymap,
  isTicketDesign,
  normalizePrinterShare,
  type Keymap,
  type TicketDesign,
} from '../../shared/register-tools';
import type { LocalStore } from '../local-store/local-store';

const KEYMAP_SETTING = 'keymap';
const TICKET_DESIGN_SETTING = 'ticket_design';
const PRINTER_SETTING = 'printer_share';

/**
 * Keeps what the owner tunes at the register: the keys, the look of the ticket, and the printer. Each one is a row of
 * `register_setting`, so no table changes. A value that no longer makes sense is read as the default instead of
 * stopping the register.
 */
export class ToolsStore {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  readonly #read: StatementSync;
  readonly #write: StatementSync;

  /**
   * @param store the open local store
   * @param tenantId the business whose settings these are
   */
  constructor(store: LocalStore, tenantId: string) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#read = store.prepare('SELECT value FROM register_setting WHERE tenant_id = ? AND name = ?');
    this.#write = store.prepare(`
      INSERT INTO register_setting (tenant_id, name, value) VALUES (?, ?, ?)
      ON CONFLICT (tenant_id, name) DO UPDATE SET value = excluded.value
    `);
  }

  /**
   * Reads the keys. A saved keymap from an older version lacks the actions added since, and those take their default
   * key; if that makes two actions share a key, the whole keymap goes back to the defaults.
   *
   * @returns the keys of the register
   */
  keymap(): Keymap {
    const saved = this.#readJson(KEYMAP_SETTING);
    if (typeof saved !== 'object' || saved === null) {
      return DEFAULT_KEYMAP;
    }
    const known = Object.fromEntries(Object.entries(saved).filter(([action]) => action in DEFAULT_KEYMAP));
    const merged = { ...DEFAULT_KEYMAP, ...known };
    return isKeymap(merged) ? merged : DEFAULT_KEYMAP;
  }

  /** @param keymap the keys to keep, already checked */
  saveKeymap(keymap: Keymap): void {
    this.#writeText(KEYMAP_SETTING, JSON.stringify(keymap));
  }

  /** @returns how the ticket looks */
  ticketDesign(): TicketDesign {
    const saved = this.#readJson(TICKET_DESIGN_SETTING);
    const merged = typeof saved === 'object' && saved !== null ? { ...DEFAULT_TICKET_DESIGN, ...saved } : DEFAULT_TICKET_DESIGN;
    return isTicketDesign(merged) ? merged : DEFAULT_TICKET_DESIGN;
  }

  /** @param design the design to keep, already checked */
  saveTicketDesign(design: TicketDesign): void {
    this.#writeText(TICKET_DESIGN_SETTING, JSON.stringify(design));
  }

  /** @returns the path of the shared printer, or an empty text when none was set */
  printerShare(): string {
    const row = this.#read.get(this.#tenantId, PRINTER_SETTING) as unknown as { value: string } | undefined;
    return normalizePrinterShare(row?.value ?? '') ?? '';
  }

  /** @param share the path of the shared printer, or an empty text for none */
  savePrinterShare(share: string): void {
    this.#writeText(PRINTER_SETTING, share);
  }

  #readJson(name: string): unknown {
    const row = this.#read.get(this.#tenantId, name) as unknown as { value: string } | undefined;
    if (row === undefined) {
      return null;
    }
    try {
      return JSON.parse(row.value) as unknown;
    } catch {
      return null;
    }
  }

  #writeText(name: string, value: string): void {
    this.#store.transaction(() => {
      this.#write.run(this.#tenantId, name, value);
    });
  }
}
