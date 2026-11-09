import type { StatementSync } from 'node:sqlite';

import type { AdjustStockRequest, AdjustStockResult, Kardex, KardexRow, LedgerCheck, LedgerProblem } from '../../shared/inventory-api';
import type { AuditLog } from '../audit/audit-log';
import type { AuthService } from '../auth/auth-service';
import type { LocalStore } from '../local-store/local-store';
import type { ProductCatalog } from '../local-store/product-catalog';
import { uuidV7 } from '../uuid-v7';
import type { StockStore } from './stock-store';

/** How many movements the kardex shows. */
const KARDEX_ROWS = 50;

interface ExpectedMovement {
  readonly productId: string;
  readonly quantityMilli: number;
}

interface SourceRow {
  readonly id: string;
  readonly product_id: string;
  readonly quantity_milli: number;
}

interface LedgerRow {
  readonly source: string;
  readonly source_id: string;
  readonly product_id: string;
  readonly quantity_milli: number;
}

/**
 * What the owner does with the stock besides selling: correcting a count, writing off a loss, reading the history of a
 * product and checking that the ledger agrees with the sales. Every change is a new movement plus an audit entry in the
 * same transaction, so neither can exist without the other (ADR 0032).
 */
export class InventoryService {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  readonly #auth: AuthService;
  readonly #stock: StockStore;
  readonly #audit: AuditLog;
  readonly #catalog: ProductCatalog;
  readonly #kardexRows: StatementSync;
  readonly #movementCount: StatementSync;

  /**
   * @param store the open local database
   * @param tenantId the business
   * @param auth who is signed in
   * @param stock the ledger
   * @param audit the audit log
   * @param catalog where the products are
   */
  constructor(store: LocalStore, tenantId: string, auth: AuthService, stock: StockStore, audit: AuditLog, catalog: ProductCatalog) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#auth = auth;
    this.#stock = stock;
    this.#audit = audit;
    this.#catalog = catalog;
    // The balance is summed over the whole history and only then cut, so the rows shown always add up to the stock.
    this.#kardexRows = store.prepare(`
      SELECT occurred_at AS occurredAt, type, quantity_milli AS quantityMilli, balance AS balanceMilli
      FROM (
        SELECT rowid AS position, occurred_at, type, quantity_milli, sum(quantity_milli) OVER (ORDER BY rowid) AS balance
        FROM stock_movement
        WHERE tenant_id = ? AND product_id = ?
      )
      ORDER BY position DESC
      LIMIT ${KARDEX_ROWS}
    `);
    this.#movementCount = store.prepare('SELECT count(*) AS total FROM stock_movement WHERE tenant_id = ? AND product_id = ?');
  }

  /**
   * Corrects a count or writes off a loss.
   *
   * @param request the product, what happened, how much and why
   * @returns the new kardex, or why nothing was recorded
   * @throws Error if the person signed in is not the owner
   * @throws RangeError if the quantity is zero or not a whole number of thousandths, or the reason is empty
   */
  adjust(request: AdjustStockRequest): AdjustStockResult {
    const user = this.#auth.currentUser();
    if (user?.role !== 'owner') {
      throw new Error('Only the owner can adjust the stock');
    }
    if (!Number.isSafeInteger(request.quantityMilli) || request.quantityMilli === 0) {
      throw new RangeError('The quantity must be a whole number of thousandths other than zero');
    }
    const reason = request.reason.trim();
    if (reason.length === 0) {
      throw new RangeError('A reason is required');
    }
    if (request.type === 'waste' && request.quantityMilli > 0) {
      return { status: 'waste_must_be_negative' };
    }
    if (this.#catalog.findById(request.productId) === null) {
      return { status: 'not_found' };
    }

    this.#store.transaction(() => {
      const movementId = uuidV7();
      this.#stock.postWithinTransaction([
        { productId: request.productId, type: request.type, quantityMilli: request.quantityMilli, source: 'adjustment', sourceId: movementId },
      ]);
      this.#audit.record({
        userId: user.id,
        action: `stock.${request.type}`,
        entity: 'product',
        entityId: request.productId,
        detail: `${request.quantityMilli} thousandths: ${reason}`,
      });
    });
    return { status: 'recorded', kardex: this.kardex(request.productId)! };
  }

  /**
   * Reads the history of a product.
   *
   * @param productId the product
   * @returns the newest movements with the balance after each, or null if the product does not exist
   */
  kardex(productId: string): Kardex | null {
    const product = this.#catalog.findById(productId);
    if (product === null) {
      return null;
    }
    const total = (this.#movementCount.get(this.#tenantId, productId) as unknown as { total: number }).total;
    return {
      productId,
      productName: product.name,
      unit: product.unit,
      stockMilli: this.#stock.levelOf(productId),
      rows: this.#kardexRows.all(this.#tenantId, productId) as unknown as KardexRow[],
      totalMovements: total,
    };
  }

  /**
   * Compares the ledger with the sales and the returns: each line must have exactly one movement with its quantity, and
   * every movement of a sale or a return must belong to a line.
   *
   * @returns how many movements were looked at and everything that does not agree
   */
  verifyLedger(): LedgerCheck {
    const expected = new Map<string, ExpectedMovement>();
    const problems: LedgerProblem[] = [];

    const soldLines = this.#store
      .prepare(
        `SELECT sale_line.id, sale_line.product_id, sale_line.quantity_milli
         FROM sale_line JOIN sale ON sale.id = sale_line.sale_id
         WHERE sale.tenant_id = ? AND sale.status = 'completed'`,
      )
      .all(this.#tenantId) as unknown as SourceRow[];
    for (const line of soldLines) {
      expected.set(`sale_line:${line.id}`, { productId: line.product_id, quantityMilli: -line.quantity_milli });
    }
    const returnedLines = this.#store
      .prepare(
        `SELECT sale_return_line.id, sale_line.product_id, sale_return_line.quantity_milli
         FROM sale_return_line JOIN sale_line ON sale_line.id = sale_return_line.sale_line_id
         WHERE sale_return_line.tenant_id = ?`,
      )
      .all(this.#tenantId) as unknown as SourceRow[];
    for (const line of returnedLines) {
      expected.set(`return_line:${line.id}`, { productId: line.product_id, quantityMilli: line.quantity_milli });
    }

    const movements = this.#store
      .prepare('SELECT source, source_id, product_id, quantity_milli FROM stock_movement WHERE tenant_id = ?')
      .all(this.#tenantId) as unknown as LedgerRow[];
    const seen = new Set<string>();
    for (const movement of movements) {
      if (movement.source !== 'sale_line' && movement.source !== 'return_line') {
        continue;
      }
      const key = `${movement.source}:${movement.source_id}`;
      const line = expected.get(key);
      if (line === undefined) {
        problems.push({ kind: 'movement_without_source', sourceId: movement.source_id });
        continue;
      }
      seen.add(key);
      if (line.productId !== movement.product_id || line.quantityMilli !== movement.quantity_milli) {
        problems.push({ kind: 'wrong_quantity', sourceId: movement.source_id });
      }
    }
    for (const key of expected.keys()) {
      if (!seen.has(key)) {
        const [source, ...rest] = key.split(':');
        problems.push({ kind: source === 'sale_line' ? 'sale_without_movement' : 'return_without_movement', sourceId: rest.join(':') });
      }
    }
    return { checkedMovements: movements.length, problems };
  }
}
