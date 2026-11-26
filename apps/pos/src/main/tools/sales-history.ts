import type { StatementSync } from 'node:sqlite';

import type { CatalogProduct } from '../../shared/pos-api';
import type { SaleSummary } from '../../shared/register-tools';
import { ticketPrintedSql } from '../checkout/ticket-print-log';
import { formatFolio } from '../checkout/ticket/ticket';
import type { LocalStore } from '../local-store/local-store';

const LIST_LIMIT = 60;
/** How many products a name can stand for in one search. More than this and the text is too vague to help. */
const PRODUCT_MATCH_LIMIT = 50;
/** A folio as the customer reads it out: `T1-000012`, `000012` or `12`. */
const FOLIO_TEXT = /^(t\d+-?)?\d+$/iu;

interface SaleRow {
  readonly id: string;
  readonly folio: number;
  readonly resolved_at: string;
  readonly business_day: string | null;
  readonly total_cents: number;
  readonly refunded_cents: number;
  readonly line_count: number;
  readonly cashier_name: string | null;
  readonly ticket_printed: number;
}

/** What the history needs of the catalog to turn a name or a code into products. */
export interface ProductLookup {
  search(text: string, limit: number, options: { readonly includeInactive: boolean }): CatalogProduct[];
  /** Every product that has or ever had the code, so the code of a product that was given up still finds its sales. */
  productIdsThatHadCode(code: string): string[];
}

const COLUMNS = `
  s.id, s.folio, s.resolved_at, s.business_day, s.total_cents,
  (SELECT COALESCE(SUM(r.total_cents), 0) FROM sale_return r WHERE r.sale_id = s.id) AS refunded_cents,
  (SELECT COUNT(*) FROM sale_line l WHERE l.sale_id = s.id) AS line_count,
  (SELECT u.name FROM app_user u WHERE u.id = s.cashier_id) AS cashier_name,
  ${ticketPrintedSql('s')} AS ticket_printed
`;

// A line matches when it is one of the products found, or when the name printed on it has the text: a product renamed
// after the sale is still found by the name the ticket shows.
const LINE_MATCHES = `(l.product_id IN (SELECT value FROM json_each(?)) OR l.product_name LIKE ? ESCAPE '\\')`;

/** Reads the completed sales, the newest first, so a past sale can be found, reprinted or cancelled. It only reads. */
export class SalesHistory {
  readonly #tenantId: string;
  readonly #catalog: ProductLookup | null;
  readonly #latest: StatementSync;
  readonly #search: StatementSync;
  readonly #matchedNames: StatementSync;

  /**
   * @param store the open local store
   * @param tenantId the business whose sales these are
   * @param catalog the products, to find a sale by the name or the code of what was sold; without it, only by folio
   */
  constructor(store: LocalStore, tenantId: string, catalog: ProductLookup | null = null) {
    this.#tenantId = tenantId;
    this.#catalog = catalog;
    this.#latest = store.prepare(`
      SELECT ${COLUMNS} FROM sale s WHERE s.tenant_id = ? AND s.status = 'completed' ORDER BY s.folio DESC LIMIT ${LIST_LIMIT}
    `);
    this.#search = store.prepare(`
      SELECT ${COLUMNS} FROM sale s
      WHERE s.tenant_id = ? AND s.status = 'completed' AND (
        (? <> '' AND CAST(s.folio AS TEXT) LIKE ?)
        OR EXISTS (SELECT 1 FROM sale_line l WHERE l.sale_id = s.id AND ${LINE_MATCHES})
      )
      ORDER BY s.folio DESC LIMIT ${LIST_LIMIT}
    `);
    this.#matchedNames = store.prepare(`
      SELECT DISTINCT l.product_name AS name FROM sale_line l WHERE l.sale_id = ? AND ${LINE_MATCHES} ORDER BY l.line_number
    `);
  }

  /**
   * Lists completed sales: by folio, by the name of a product sold, or by its code.
   *
   * @param text a folio or part of it (`T1-000012`, `12`), part of a product name (`cinta`), or a code; empty lists the latest
   * @returns up to sixty sales, the newest first; a sale found by a product says which products of it matched
   */
  list(text: string): SaleSummary[] {
    const trimmed = text.trim();
    if (trimmed === '') {
      return (this.#latest.all(this.#tenantId) as unknown as SaleRow[]).map((row) => toSummary(row, []));
    }
    // Only the digits of a folio count, without the zeros that pad it, so 12, 000012 and T1-000012 find the same sale.
    const folioDigits = FOLIO_TEXT.test(trimmed) ? trimmed.replace(/^.*-/u, '').replace(/^0+/u, '') : '';
    const productIds = JSON.stringify(this.#productsMatching(trimmed));
    const namePattern = `%${trimmed.replace(/[\\%_]/gu, (character) => `\\${character}`)}%`;
    const rows = this.#search.all(this.#tenantId, folioDigits, `%${folioDigits}%`, productIds, namePattern) as unknown as SaleRow[];
    return rows.map((row) => {
      const names = this.#matchedNames.all(row.id, productIds, namePattern) as unknown as { name: string }[];
      return toSummary(row, names.map((entry) => entry.name));
    });
  }

  #productsMatching(text: string): string[] {
    if (this.#catalog === null) {
      return [];
    }
    const byName = this.#catalog.search(text, PRODUCT_MATCH_LIMIT, { includeInactive: true }).map((product) => product.id);
    const byCode = this.#catalog.productIdsThatHadCode(text);
    return [...new Set([...byCode, ...byName])];
  }
}

function toSummary(row: SaleRow, matchedProducts: readonly string[]): SaleSummary {
  return {
    saleId: row.id,
    folio: formatFolio(row.folio),
    completedAt: row.resolved_at,
    businessDay: row.business_day,
    totalCents: row.total_cents,
    refundedCents: row.refunded_cents,
    cashierName: row.cashier_name,
    lineCount: row.line_count,
    matchedProducts,
    ticketPrinted: row.ticket_printed === 1,
  };
}
