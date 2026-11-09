import type { StatementSync } from 'node:sqlite';

import type { Unit } from '@pos-saas/money';

import type { RefundShare } from '../../shared/returns';
import type { LocalStore } from '../local-store/local-store';
import { uuidV7 } from '../uuid-v7';

/** A completed sale, as the database has it. */
export interface CompletedSaleRow {
  readonly id: string;
  readonly folio: number;
  readonly completedAt: string;
  readonly totalCents: number;
}

/** A line of a sale with what already came back. */
export interface ReturnLineRow {
  readonly id: string;
  readonly productName: string;
  readonly unit: Unit;
  readonly soldMilli: number;
  readonly unitPriceE4: number;
  readonly lineTotalCents: number;
  readonly returnedMilli: number;
  readonly refundedCents: number;
}

/** What the customer paid with, and what was already given back by that means. */
export interface PaymentRefundRow {
  readonly method: 'cash' | 'transfer' | 'card' | 'card_manual';
  readonly reference: string | null;
  readonly paidCents: number;
  readonly refundedCents: number;
}

/** Everything saved when something comes back. */
export interface ReturnRecord {
  readonly saleId: string;
  readonly cashSessionId: string;
  readonly requestedBy: string;
  readonly authorizedBy: string;
  readonly reason: string;
  readonly totalCents: number;
  readonly lines: readonly { readonly saleLineId: string; readonly quantityMilli: number; readonly refundCents: number }[];
  readonly refunds: readonly RefundShare[];
}

interface SaleRowSql {
  readonly id: string;
  readonly folio: number;
  readonly resolved_at: string;
  readonly total_cents: number;
}

interface LineRowSql {
  readonly id: string;
  readonly product_name: string;
  readonly unit: Unit;
  readonly quantity_milli: number;
  readonly unit_price_e4: number;
  readonly line_total_cents: number;
  readonly returned_milli: number;
  readonly refunded_cents: number;
}

interface PaymentRowSql {
  readonly method: PaymentRefundRow['method'];
  readonly reference: string | null;
  readonly paid_cents: number;
  readonly refunded_cents: number;
}

/** Keeps the returns of one business. A return is a record next to the sale, and the sale itself never changes. */
export class ReturnStore {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  readonly #findByFolio: StatementSync;
  readonly #findById: StatementSync;
  readonly #lines: StatementSync;
  readonly #payments: StatementSync;
  readonly #insertReturn: StatementSync;
  readonly #insertLine: StatementSync;
  readonly #insertRefund: StatementSync;

  /**
   * @param store the open local database
   * @param tenantId the business whose returns this store sees
   */
  constructor(store: LocalStore, tenantId: string) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#findByFolio = store.prepare(`
      SELECT id, folio, resolved_at, total_cents FROM sale WHERE tenant_id = ? AND folio = ? AND status = 'completed'
    `);
    this.#findById = store.prepare(`
      SELECT id, folio, resolved_at, total_cents FROM sale WHERE tenant_id = ? AND id = ? AND status = 'completed'
    `);
    this.#lines = store.prepare(`
      SELECT l.id, l.product_name, l.unit, l.quantity_milli, l.unit_price_e4, l.line_total_cents,
        coalesce((SELECT sum(rl.quantity_milli) FROM sale_return_line rl WHERE rl.sale_line_id = l.id), 0) AS returned_milli,
        coalesce((SELECT sum(rl.refund_cents) FROM sale_return_line rl WHERE rl.sale_line_id = l.id), 0) AS refunded_cents
      FROM sale_line l WHERE l.tenant_id = ? AND l.sale_id = ? ORDER BY l.line_number
    `);
    this.#payments = store.prepare(`
      SELECT p.method, p.reference, p.amount_cents AS paid_cents,
        coalesce((
          SELECT sum(rp.amount_cents) FROM refund_payment rp JOIN sale_return r ON r.id = rp.return_id
          WHERE r.sale_id = p.sale_id AND rp.method = p.method AND rp.reference IS p.reference
        ), 0) AS refunded_cents
      FROM payment p WHERE p.tenant_id = ? AND p.sale_id = ? ORDER BY p.rowid
    `);
    this.#insertReturn = store.prepare(`
      INSERT INTO sale_return (id, tenant_id, sale_id, cash_session_id, requested_by, authorized_by, reason, total_cents, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.#insertLine = store.prepare(`
      INSERT INTO sale_return_line (id, tenant_id, return_id, sale_line_id, quantity_milli, refund_cents) VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.#insertRefund = store.prepare(`
      INSERT INTO refund_payment (id, tenant_id, return_id, method, amount_cents, reference) VALUES (?, ?, ?, ?, ?, ?)
    `);
  }

  /**
   * Finds a completed sale by the number of its folio.
   *
   * @param folio the number of the folio
   * @returns the sale, or null if there is no completed sale with it
   */
  findCompletedByFolio(folio: number): CompletedSaleRow | null {
    const row = this.#findByFolio.get(this.#tenantId, folio) as unknown as SaleRowSql | undefined;
    return row === undefined ? null : { id: row.id, folio: row.folio, completedAt: row.resolved_at, totalCents: row.total_cents };
  }

  /**
   * Finds a completed sale by its id.
   *
   * @param saleId the sale
   * @returns the sale, or null if it does not exist or is not completed
   */
  findCompletedById(saleId: string): CompletedSaleRow | null {
    const row = this.#findById.get(this.#tenantId, saleId) as unknown as SaleRowSql | undefined;
    return row === undefined ? null : { id: row.id, folio: row.folio, completedAt: row.resolved_at, totalCents: row.total_cents };
  }

  /**
   * Reads the lines of a sale with what came back from each.
   *
   * @param saleId the sale
   * @returns its lines in order
   */
  lines(saleId: string): ReturnLineRow[] {
    return (this.#lines.all(this.#tenantId, saleId) as unknown as LineRowSql[]).map((row) => ({
      id: row.id,
      productName: row.product_name,
      unit: row.unit,
      soldMilli: row.quantity_milli,
      unitPriceE4: row.unit_price_e4,
      lineTotalCents: row.line_total_cents,
      returnedMilli: row.returned_milli,
      refundedCents: row.refunded_cents,
    }));
  }

  /**
   * Reads what the customer paid with and what was already given back by each means.
   *
   * @param saleId the sale
   * @returns its payments in the order they were recorded
   */
  payments(saleId: string): PaymentRefundRow[] {
    return (this.#payments.all(this.#tenantId, saleId) as unknown as PaymentRowSql[]).map((row) => ({
      method: row.method,
      reference: row.reference,
      paidCents: row.paid_cents,
      refundedCents: row.refunded_cents,
    }));
  }

  /**
   * Saves a return, its lines, and what is given back, all in one transaction.
   *
   * @param record the return
   * @returns the id of the return
   */
  insert(record: ReturnRecord): string {
    const id = uuidV7();
    this.#store.transaction(() => {
      this.#insertReturn.run(
        id,
        this.#tenantId,
        record.saleId,
        record.cashSessionId,
        record.requestedBy,
        record.authorizedBy,
        record.reason,
        record.totalCents,
        new Date().toISOString(),
      );
      for (const line of record.lines) {
        this.#insertLine.run(uuidV7(), this.#tenantId, id, line.saleLineId, line.quantityMilli, line.refundCents);
      }
      for (const refund of record.refunds) {
        this.#insertRefund.run(uuidV7(), this.#tenantId, id, refund.method, refund.amountCents, refund.reference);
      }
    });
    return id;
  }
}
