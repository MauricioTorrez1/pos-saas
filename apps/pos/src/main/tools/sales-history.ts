import type { StatementSync } from 'node:sqlite';

import type { SaleSummary } from '../../shared/register-tools';
import { formatFolio } from '../checkout/ticket/ticket';
import type { LocalStore } from '../local-store/local-store';

const LIST_LIMIT = 60;

interface SaleRow {
  readonly id: string;
  readonly folio: number;
  readonly resolved_at: string;
  readonly total_cents: number;
  readonly refunded_cents: number;
  readonly line_count: number;
  readonly cashier_name: string | null;
}

const COLUMNS = `
  s.id, s.folio, s.resolved_at, s.total_cents,
  (SELECT COALESCE(SUM(r.total_cents), 0) FROM sale_return r WHERE r.sale_id = s.id) AS refunded_cents,
  (SELECT COUNT(*) FROM sale_line l WHERE l.sale_id = s.id) AS line_count,
  (SELECT u.name FROM app_user u WHERE u.id = s.cashier_id) AS cashier_name
`;

/** Reads the completed sales, the newest first, so a past sale can be found and cancelled. It only reads. */
export class SalesHistory {
  readonly #tenantId: string;
  readonly #latest: StatementSync;
  readonly #byFolio: StatementSync;

  /**
   * @param store the open local store
   * @param tenantId the business whose sales these are
   */
  constructor(store: LocalStore, tenantId: string) {
    this.#tenantId = tenantId;
    this.#latest = store.prepare(`
      SELECT ${COLUMNS} FROM sale s WHERE s.tenant_id = ? AND s.status = 'completed' ORDER BY s.folio DESC LIMIT ${LIST_LIMIT}
    `);
    this.#byFolio = store.prepare(`
      SELECT ${COLUMNS} FROM sale s
      WHERE s.tenant_id = ? AND s.status = 'completed' AND CAST(s.folio AS TEXT) LIKE ?
      ORDER BY s.folio DESC LIMIT ${LIST_LIMIT}
    `);
  }

  /**
   * Lists completed sales.
   *
   * @param text a folio or part of it, such as `T1-000012` or `12`; an empty text lists the latest
   * @returns up to sixty sales, the newest first
   */
  list(text: string): SaleSummary[] {
    // Only the digits count, without the zeros that pad the folio, so 12, 000012 and T1-000012 find the same sale.
    const digits = text.replace(/^.*-/u, '').replace(/\D/gu, '').replace(/^0+/u, '');
    const rows = (digits === '' ? this.#latest.all(this.#tenantId) : this.#byFolio.all(this.#tenantId, `%${digits}%`)) as unknown as SaleRow[];
    return rows.map((row) => ({
      saleId: row.id,
      folio: formatFolio(row.folio),
      completedAt: row.resolved_at,
      totalCents: row.total_cents,
      refundedCents: row.refunded_cents,
      cashierName: row.cashier_name,
      lineCount: row.line_count,
    }));
  }
}
