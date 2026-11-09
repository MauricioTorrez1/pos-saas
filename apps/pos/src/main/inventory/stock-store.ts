import type { StatementSync } from 'node:sqlite';

import type { LocalStore } from '../local-store/local-store';
import { uuidV7 } from '../uuid-v7';

/** What can move the stock of a product. */
export const STOCK_MOVEMENT_TYPES = ['opening_balance', 'sale', 'return', 'adjustment', 'waste'] as const;

/** One of the kinds of movement. */
export type StockMovementType = (typeof STOCK_MOVEMENT_TYPES)[number];

/** A movement to post. The quantity is signed: a sale takes stock out, and a return puts it back. */
export interface StockMovementToPost {
  readonly productId: string;
  readonly type: StockMovementType;
  /** In thousandths of the base unit, never zero. */
  readonly quantityMilli: number;
  /** Cost per unit in millionths of a peso, when it is known. */
  readonly unitCostE6?: number;
  /** What caused it, such as `sale_line` or `import`. */
  readonly source: string;
  /** Which one of that source, so the same one is never posted twice. */
  readonly sourceId: string;
}

/** Posts a movement, and does nothing if its source already posted it. Sales and returns prepare it too. */
export const INSERT_STOCK_MOVEMENT_SQL = `
  INSERT INTO stock_movement (id, tenant_id, product_id, type, quantity_milli, unit_cost_e6, source, source_id, occurred_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (tenant_id, source, source_id, product_id) DO NOTHING
`;

/**
 * The inventory as an immutable ledger: the stock of a product is the sum of its movements, and a movement is never
 * edited or deleted. A correction is a new movement. Stock can go below zero, because a sale already happened and the
 * shelf was just not counted (ADR 0003).
 */
export class StockStore {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  readonly #insert: StatementSync;
  readonly #levelOf: StatementSync;

  /**
   * @param store the open local database
   * @param tenantId the business whose stock this store sees
   */
  constructor(store: LocalStore, tenantId: string) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#insert = store.prepare(INSERT_STOCK_MOVEMENT_SQL);
    this.#levelOf = store.prepare('SELECT coalesce(sum(quantity_milli), 0) AS total FROM stock_movement WHERE tenant_id = ? AND product_id = ?');
  }

  /**
   * Posts movements in one transaction. One that was already posted by the same source is ignored, so repeating an import
   * or receiving a sale twice never counts it twice.
   *
   * @param movements what to post
   * @returns how many were new
   */
  post(movements: readonly StockMovementToPost[]): number {
    return this.#store.transaction(() => this.postWithinTransaction(movements));
  }

  /**
   * Posts movements inside a transaction that is already open, so they commit or roll back with what the caller is doing.
   *
   * @param movements what to post
   * @returns how many were new
   */
  postWithinTransaction(movements: readonly StockMovementToPost[]): number {
    return postWith(this.#insert, this.#tenantId, movements);
  }

  /**
   * Reads the stock of a product.
   *
   * @param productId the product
   * @returns the sum of its movements in thousandths of its unit, which may be negative
   */
  levelOf(productId: string): number {
    return (this.#levelOf.get(this.#tenantId, productId) as unknown as { total: number }).total;
  }
}

/**
 * Posts movements with a statement that already belongs to a transaction, so a sale and its stock move together.
 *
 * @param insert the prepared insert that does nothing on a repeated source
 * @param tenantId the business
 * @param movements what to post
 * @returns how many were new
 */
export function postWith(insert: StatementSync, tenantId: string, movements: readonly StockMovementToPost[]): number {
  const occurredAt = new Date().toISOString();
  let created = 0;
  for (const movement of movements) {
    const result = insert.run(
      uuidV7(),
      tenantId,
      movement.productId,
      movement.type,
      movement.quantityMilli,
      movement.unitCostE6 ?? null,
      movement.source,
      movement.sourceId,
      occurredAt,
    );
    created += Number(result.changes);
  }
  return created;
}
