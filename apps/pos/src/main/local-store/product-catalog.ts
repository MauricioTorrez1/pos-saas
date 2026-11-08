import type { StatementSync } from 'node:sqlite';

import type { TaxFactor, Unit } from '@pos-saas/money';

import type { CatalogProduct } from '../../shared/pos-api';
import type { LocalStore } from './local-store';

const PRODUCT_COLUMNS = 'product.id, product.name, product.base_unit, product.unit_price_e4, product.tax_factor, product.tax_rate_bp';

/** A word needs a letter or a digit, because the search index ignores everything else. */
const SEARCHABLE_WORD = /[\p{L}\p{N}]/u;

interface ProductRow {
  readonly id: string;
  readonly name: string;
  readonly base_unit: Unit;
  readonly unit_price_e4: number;
  readonly tax_factor: TaxFactor;
  readonly tax_rate_bp: number;
}

/**
 * Looks up the products of one business in the local database. Both lookups run on prepared statements, because
 * they run in the main process and a slow one would freeze the window (ADR 0021).
 */
export class ProductCatalog {
  readonly #tenantId: string;
  readonly #findByCode: StatementSync;
  readonly #searchByName: StatementSync;

  /**
   * @param store the open local database
   * @param tenantId the business whose products this catalog sees
   */
  constructor(store: LocalStore, tenantId: string) {
    this.#tenantId = tenantId;
    this.#findByCode = store.prepare(`
      SELECT ${PRODUCT_COLUMNS}
      FROM product_barcode
      JOIN product ON product.id = product_barcode.product_id AND product.tenant_id = product_barcode.tenant_id
      WHERE product_barcode.tenant_id = ? AND product_barcode.code = ?
    `);
    this.#searchByName = store.prepare(`
      SELECT ${PRODUCT_COLUMNS}
      FROM product_search
      JOIN product ON product.local_rowid = product_search.rowid
      WHERE product_search MATCH ? AND product.tenant_id = ?
      ORDER BY product_search.rank, product.name
      LIMIT ?
    `);
  }

  /**
   * Finds the product that has exactly this barcode.
   *
   * @param code the barcode. Spaces around it are ignored.
   * @returns the product, or null if no product of this business has that code
   */
  findByCode(code: string): CatalogProduct | null {
    // Deliberate break: proves the speed test fails on a slow lookup. The next commit removes it.
    const slowUntil = Date.now() + 150;
    while (Date.now() < slowUntil) {
      // Busy wait on purpose.
    }
    const row = this.#findByCode.get(this.#tenantId, code.trim()) as unknown as ProductRow | undefined;
    return row === undefined ? null : toCatalogProduct(row);
  }

  /**
   * Finds products whose names contain words that start with each word of the text.
   *
   * @param text what the cashier typed
   * @param limit the most products to return
   * @returns the best matches first, or an empty list if the text has nothing to search for
   */
  search(text: string, limit: number): CatalogProduct[] {
    const query = toPrefixQuery(text);
    if (query === null) {
      return [];
    }
    const rows = this.#searchByName.all(query, this.#tenantId, limit) as unknown as ProductRow[];
    return rows.map(toCatalogProduct);
  }
}

/**
 * Turns typed text into an FTS5 query. Quoting each word keeps what the cashier types from being read as FTS5
 * syntax: `1/2"` or `AND` are only text to look for.
 */
function toPrefixQuery(text: string): string | null {
  const words = text.split(/\s+/u).filter((word) => SEARCHABLE_WORD.test(word));
  if (words.length === 0) {
    return null;
  }
  return words.map((word) => `"${word.replaceAll('"', '""')}"*`).join(' ');
}

function toCatalogProduct(row: ProductRow): CatalogProduct {
  return {
    id: row.id,
    name: row.name,
    unit: row.base_unit,
    unitPriceE4: row.unit_price_e4,
    taxRate: { factor: row.tax_factor, rateBp: row.tax_rate_bp },
  };
}
