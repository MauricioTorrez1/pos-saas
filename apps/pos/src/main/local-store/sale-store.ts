import type { StatementSync } from 'node:sqlite';

import type { Unit } from '@pos-saas/money';

import type { PendingSale, PendingSaleLine } from '../../shared/pos-api';
import {
  SaleAlreadyCompletedError,
  type RecordedPayment,
  type SaleLineToSave,
  type SaleRecorder,
  type SaleToSave,
} from '../checkout/sale-recorder';
import { assertSaleTransition, InvalidSaleTransitionError, type SaleStatus } from '../checkout/sale-state-machine';
import { uuidV7 } from '../uuid-v7';
import type { LocalStore } from './local-store';

/** No sale of this business has that id. */
export class SaleNotFoundError extends Error {
  /** @param saleId the sale that was asked for */
  constructor(saleId: string) {
    super(`Sale ${saleId} does not exist`);
    this.name = 'SaleNotFoundError';
  }
}

interface SaleStateRow {
  readonly status: SaleStatus;
  readonly total_cents: number;
}

interface PendingSaleRow {
  readonly id: string;
  readonly occurred_at: string;
  readonly total_cents: number;
}

interface PendingLineRow {
  readonly product_name: string;
  readonly unit: Unit;
  readonly quantity_milli: number;
  readonly unit_price_e4: number;
  readonly line_total_cents: number;
}

/**
 * Keeps the sales of one business in the local database. Every change of state is one transaction: if the register
 * dies halfway, the sale is left exactly as it was (ADR 0010, ADR 0025).
 */
export class SaleStore implements SaleRecorder {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  readonly #findState: StatementSync;
  readonly #listPending: StatementSync;
  readonly #findPendingByKey: StatementSync;
  readonly #linesOf: StatementSync;
  readonly #insertSale: StatementSync;
  readonly #insertLine: StatementSync;
  readonly #insertPayment: StatementSync;
  readonly #resolve: StatementSync;

  /**
   * @param store the open local database
   * @param tenantId the business whose sales this store sees
   */
  constructor(store: LocalStore, tenantId: string) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#findState = store.prepare('SELECT status, total_cents FROM sale WHERE tenant_id = ? AND id = ?');
    this.#listPending = store.prepare(`
      SELECT id, occurred_at, total_cents FROM sale WHERE tenant_id = ? AND status = 'pending_payment' ORDER BY id
    `);
    this.#findPendingByKey = store.prepare(`
      SELECT id, occurred_at, total_cents FROM sale
      WHERE tenant_id = ? AND idempotency_key = ? AND status = 'pending_payment'
    `);
    this.#linesOf = store.prepare(`
      SELECT product_name, unit, quantity_milli, unit_price_e4, line_total_cents
      FROM sale_line WHERE tenant_id = ? AND sale_id = ? ORDER BY line_number
    `);
    this.#insertSale = store.prepare(`
      INSERT INTO sale (id, tenant_id, idempotency_key, status, subtotal_cents, tax_cents, total_cents, occurred_at)
      VALUES (?, ?, ?, 'pending_payment', ?, ?, ?, ?)
    `);
    this.#insertLine = store.prepare(`
      INSERT INTO sale_line (id, tenant_id, sale_id, line_number, product_id, product_name, unit, quantity_milli,
        unit_price_e4, tax_factor, tax_rate_bp, subtotal_cents, tax_cents, line_total_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.#insertPayment = store.prepare(`
      INSERT INTO payment (id, tenant_id, sale_id, method, amount_cents, reference, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.#resolve = store.prepare('UPDATE sale SET status = ?, resolved_at = ? WHERE tenant_id = ? AND id = ?');
  }

  /**
   * {@inheritDoc SaleRecorder.savePendingPayment}
   *
   * @throws InvalidSaleTransitionError if the sale was cancelled
   */
  savePendingPayment(sale: SaleToSave): void {
    this.#store.transaction(() => {
      const existing = this.#findState.get(this.#tenantId, sale.saleId) as unknown as SaleStateRow | undefined;
      if (existing === undefined) {
        this.#insert(sale);
      } else {
        assertStillPending(sale.saleId, existing.status);
      }
    });
  }

  /**
   * {@inheritDoc SaleRecorder.markCompleted}
   *
   * The payment and the new state are written together, and a payment only exists for a completed sale, so a cash-up
   * that adds payments cannot count a pending sale.
   *
   * @throws SaleNotFoundError if the sale does not exist
   * @throws InvalidSaleTransitionError if the sale is not pending
   */
  markCompleted(saleId: string, payment: RecordedPayment): void {
    this.#store.transaction(() => {
      const { status, total_cents: totalCents } = this.#requireState(saleId);
      assertSaleTransition(saleId, status, 'completed');
      const now = new Date().toISOString();
      this.#insertPayment.run(uuidV7(), this.#tenantId, saleId, payment.method, totalCents, referenceOf(payment), now);
      this.#resolve.run('completed', now, this.#tenantId, saleId);
    });
  }

  /**
   * Marks a pending sale as `cancelled`. It stays in the database, because a sale is never deleted.
   *
   * @param saleId the sale that was not paid
   * @throws SaleNotFoundError if the sale does not exist
   * @throws InvalidSaleTransitionError if the sale is not pending
   */
  cancel(saleId: string): void {
    this.#store.transaction(() => {
      assertSaleTransition(saleId, this.#requireState(saleId).status, 'cancelled');
      this.#resolve.run('cancelled', new Date().toISOString(), this.#tenantId, saleId);
    });
  }

  /**
   * Reads the sales waiting to be resolved.
   *
   * @returns the pending sales of this business, oldest first
   */
  listPending(): PendingSale[] {
    const rows = this.#listPending.all(this.#tenantId) as unknown as PendingSaleRow[];
    return rows.map((row) => this.#toPendingSale(row));
  }

  /**
   * Finds the pending sale created with this key.
   *
   * @param idempotencyKey the key sent when the sale was saved
   * @returns the sale, or null if there is no pending sale with that key
   */
  findPendingByIdempotencyKey(idempotencyKey: string): PendingSale | null {
    const row = this.#findPendingByKey.get(this.#tenantId, idempotencyKey) as unknown as PendingSaleRow | undefined;
    return row === undefined ? null : this.#toPendingSale(row);
  }

  #insert(sale: SaleToSave): void {
    const { saleId, idempotencyKey, subtotalCents, taxCents, totalCents } = sale;
    this.#insertSale.run(saleId, this.#tenantId, idempotencyKey, subtotalCents, taxCents, totalCents, new Date().toISOString());
    sale.lines.forEach((line, index) => this.#insertSaleLine(saleId, line, index + 1));
  }

  #insertSaleLine(saleId: string, line: SaleLineToSave, lineNumber: number): void {
    const { subtotalCents, taxCents, totalCents, taxRate } = line.totals;
    this.#insertLine.run(
      line.id,
      this.#tenantId,
      saleId,
      lineNumber,
      line.productId,
      line.productName,
      line.quantity.unit,
      line.quantity.milli,
      line.unitPriceE4,
      taxRate.factor,
      taxRate.rateBp,
      subtotalCents,
      taxCents,
      totalCents,
    );
  }

  #requireState(saleId: string): SaleStateRow {
    const row = this.#findState.get(this.#tenantId, saleId) as unknown as SaleStateRow | undefined;
    if (row === undefined) {
      throw new SaleNotFoundError(saleId);
    }
    return row;
  }

  #toPendingSale({ id, occurred_at: occurredAt, total_cents: totalCents }: PendingSaleRow): PendingSale {
    const lines = this.#linesOf.all(this.#tenantId, id) as unknown as PendingLineRow[];
    return { id, occurredAt, totalCents, lines: lines.map(toPendingSaleLine) };
  }
}

/** Saving a sale again is only for trying another payment method, which makes no sense once it is resolved. */
function assertStillPending(saleId: string, status: SaleStatus): void {
  if (status === 'completed') {
    throw new SaleAlreadyCompletedError(saleId);
  }
  if (status !== 'pending_payment') {
    throw new InvalidSaleTransitionError(saleId, status, 'pending_payment');
  }
}

function referenceOf(payment: RecordedPayment): string | null {
  return payment.method === 'card' ? payment.authorizationCode : null;
}

function toPendingSaleLine(row: PendingLineRow): PendingSaleLine {
  return {
    productName: row.product_name,
    quantity: { milli: row.quantity_milli, unit: row.unit },
    unitPriceE4: row.unit_price_e4,
    totalCents: row.line_total_cents,
  };
}
