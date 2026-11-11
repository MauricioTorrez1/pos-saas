import type { StatementSync } from 'node:sqlite';

import type { LocalStore } from '../local-store/local-store';
import { INITIAL_CURSOR, isCursorBehind, type PullChange, type PullPage } from './pull-protocol';
import { SyncProtocolError } from './sync-protocol';

/** What applying one page changed. */
export interface ApplyOutcome {
  /** Products created or replaced with the state of the core. */
  readonly productsSaved: number;
  /** Products removed because the core deleted them. */
  readonly productsRemoved: number;
  /** Staff members created or replaced. */
  readonly staffSaved: number;
  /** Review decisions saved or replaced. */
  readonly reviewsSaved: number;
  /** The cursor after the page. */
  readonly cursor: string;
}

/**
 * Writes the changes that come from the core into the local database, and moves the cursor with them. The whole page and
 * its cursor are one local transaction, so the cursor never claims more than what was applied: if the app dies, the disk
 * fails or a change cannot be written, nothing of the page stays and the next pull asks for it again. Every change carries
 * the whole state of its entity, so applying a page twice leaves the same result (ADR 0048).
 */
export class ChangeApplier {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  readonly #readCursor: StatementSync;
  readonly #writeCursor: StatementSync;
  readonly #saveProduct: StatementSync;
  readonly #removeProduct: StatementSync;
  readonly #clearBarcodes: StatementSync;
  readonly #saveBarcode: StatementSync;
  readonly #saveStaff: StatementSync;
  readonly #removeStaff: StatementSync;
  readonly #saveReview: StatementSync;
  readonly #removeReview: StatementSync;

  /**
   * @param store the open local database
   * @param tenantId the business of this register; the changes are written under it
   */
  constructor(store: LocalStore, tenantId: string) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#readCursor = store.prepare('SELECT cursor FROM sync_pull_state WHERE tenant_id = ?');
    this.#writeCursor = store.prepare(`
      INSERT INTO sync_pull_state (tenant_id, cursor, updated_at) VALUES (?, ?, ?)
      ON CONFLICT (tenant_id) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at
    `);
    // A product that arrives is the state of the core, so it also stops being a sample product.
    this.#saveProduct = store.prepare(`
      INSERT INTO product (id, tenant_id, name, base_unit, unit_price_e4, tax_factor, tax_rate_bp, is_sample)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT (id) DO UPDATE SET
        name = excluded.name, base_unit = excluded.base_unit, unit_price_e4 = excluded.unit_price_e4,
        tax_factor = excluded.tax_factor, tax_rate_bp = excluded.tax_rate_bp, is_sample = 0
      WHERE product.tenant_id = excluded.tenant_id
    `);
    this.#removeProduct = store.prepare('DELETE FROM product WHERE tenant_id = ? AND id = ?');
    this.#clearBarcodes = store.prepare('DELETE FROM product_barcode WHERE tenant_id = ? AND product_id = ?');
    // A code that moved to another product follows the newest state.
    this.#saveBarcode = store.prepare(`
      INSERT INTO product_barcode (tenant_id, code, product_id) VALUES (?, ?, ?)
      ON CONFLICT (tenant_id, code) DO UPDATE SET product_id = excluded.product_id
    `);
    this.#saveStaff = store.prepare(`
      INSERT INTO staff_permission (id, tenant_id, display_name, role, permissions, is_active) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET display_name = excluded.display_name, role = excluded.role,
        permissions = excluded.permissions, is_active = excluded.is_active
      WHERE staff_permission.tenant_id = excluded.tenant_id
    `);
    this.#removeStaff = store.prepare('DELETE FROM staff_permission WHERE tenant_id = ? AND id = ?');
    this.#saveReview = store.prepare(`
      INSERT INTO operation_review (id, tenant_id, kind, resolution, operation_type, reason, resolved_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, resolution = excluded.resolution, operation_type = excluded.operation_type,
        reason = excluded.reason, resolved_at = excluded.resolved_at
      WHERE operation_review.tenant_id = excluded.tenant_id
    `);
    this.#removeReview = store.prepare('DELETE FROM operation_review WHERE tenant_id = ? AND id = ?');
  }

  /**
   * Reads the cursor to send to the core.
   *
   * @returns the number of the last change applied, as text, or `0` if this register never pulled
   */
  currentCursor(): string {
    const row = this.#readCursor.get(this.#tenantId) as unknown as { cursor: string } | undefined;
    return row?.cursor ?? INITIAL_CURSOR;
  }

  /**
   * Forgets the cursor, for when the core says it is ahead of what the core has (a core restored from a backup). The next
   * pull starts over, which is safe because every change is the whole state of its entity.
   */
  resetCursor(): void {
    this.#store.transaction(() => {
      this.#writeCursor.run(this.#tenantId, INITIAL_CURSOR, new Date().toISOString());
    });
  }

  /**
   * Applies a page and its cursor, all or nothing.
   *
   * @param page a page that already passed `parsePullResponse`
   * @returns what changed and the new cursor
   * @throws SyncProtocolError if the page would move the cursor backwards, so a core that went back is noticed
   * @throws Error whatever the local database throws; nothing of the page is kept then
   */
  apply(page: PullPage): ApplyOutcome {
    return this.#store.transaction(() => {
      const cursor = this.currentCursor();
      if (isCursorBehind(page.nextCursor, cursor)) {
        throw new SyncProtocolError(`it would move the cursor back from ${cursor} to ${page.nextCursor}`);
      }
      const totals = { productsSaved: 0, productsRemoved: 0, staffSaved: 0, reviewsSaved: 0 };
      for (const change of page.changes) {
        this.#applyChange(change, totals);
      }
      this.#writeCursor.run(this.#tenantId, page.nextCursor, new Date().toISOString());
      return { ...totals, cursor: page.nextCursor };
    });
  }

  #applyChange(change: PullChange, totals: { productsSaved: number; productsRemoved: number; staffSaved: number; reviewsSaved: number }): void {
    if (change.entityType === 'product') {
      if (change.deleted) {
        // The barcodes go with the product (cascade), and the search index follows through its trigger.
        totals.productsRemoved += Number(this.#removeProduct.run(this.#tenantId, change.entityId).changes);
        return;
      }
      const { name, baseUnit, unitPriceE4, taxFactor, taxRateBp, barcodes } = change.payload;
      this.#saveProduct.run(change.entityId, this.#tenantId, name, baseUnit, unitPriceE4, taxFactor, taxRateBp);
      this.#clearBarcodes.run(this.#tenantId, change.entityId);
      for (const code of barcodes) {
        this.#saveBarcode.run(this.#tenantId, code, change.entityId);
      }
      totals.productsSaved += 1;
      return;
    }
    if (change.entityType === 'review_resolution') {
      if (change.deleted) {
        this.#removeReview.run(this.#tenantId, change.entityId);
        return;
      }
      const { kind, resolution, operationType, reason, resolvedAt } = change.payload;
      this.#saveReview.run(change.entityId, this.#tenantId, kind, resolution, operationType, reason, resolvedAt);
      totals.reviewsSaved += 1;
      return;
    }
    if (change.deleted) {
      this.#removeStaff.run(this.#tenantId, change.entityId);
      return;
    }
    const { displayName, role, permissions, active } = change.payload;
    this.#saveStaff.run(change.entityId, this.#tenantId, displayName, role, JSON.stringify(permissions), active ? 1 : 0);
    totals.staffSaved += 1;
  }
}
