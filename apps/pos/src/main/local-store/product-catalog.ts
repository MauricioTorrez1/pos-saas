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

/** How a lookup treats the products that were given up. */
export interface LookupOptions {
  /** Also finds the products with `is_active = 0`. The sale never asks for them. */
  readonly includeInactive?: boolean;
}

/**
 * Looks up the products of one business in the local database. Both lookups run on prepared statements, because
 * they run in the main process and a slow one would freeze the window (ADR 0021).
 */
export class ProductCatalog {
  readonly #tenantId: string;
  readonly #findById: StatementSync;
  readonly #findByCode: StatementSync;
  readonly #searchByName: StatementSync;
  readonly #findByIdAny: StatementSync;
  readonly #findByCodeAny: StatementSync;
  readonly #searchByNameAny: StatementSync;
  readonly #updatePrice: StatementSync;

  /**
   * @param store the open local database
   * @param tenantId the business whose products this catalog sees
   */
  constructor(store: LocalStore, tenantId: string) {
    this.#tenantId = tenantId;
    // A product that was given up (is_active = 0) is not sold or found by the sale screen, but the product screens still see it.
    const byId = `SELECT ${PRODUCT_COLUMNS} FROM product WHERE product.tenant_id = ? AND product.id = ?`;
    const byCode = `
      SELECT ${PRODUCT_COLUMNS}
      FROM product_barcode
      JOIN product ON product.id = product_barcode.product_id AND product.tenant_id = product_barcode.tenant_id
      WHERE product_barcode.tenant_id = ? AND product_barcode.code = ?
    `;
    const byName = `
      SELECT ${PRODUCT_COLUMNS}
      FROM product_search
      JOIN product ON product.local_rowid = product_search.rowid
      WHERE product_search MATCH ? AND product.tenant_id = ?
    `;
    const nameOrder = 'ORDER BY product_search.rank, product.name LIMIT ?';
    this.#findById = store.prepare(`${byId} AND product.is_active = 1`);
    this.#findByIdAny = store.prepare(byId);
    this.#findByCode = store.prepare(`${byCode} AND product.is_active = 1`);
    this.#findByCodeAny = store.prepare(byCode);
    this.#searchByName = store.prepare(`${byName} AND product.is_active = 1 ${nameOrder}`);
    this.#searchByNameAny = store.prepare(`${byName} ${nameOrder}`);
    this.#updatePrice = store.prepare('UPDATE product SET unit_price_e4 = ? WHERE tenant_id = ? AND id = ? AND unit_price_e4 = ?');
  }

  /**
   * Replaces the price of a product, but only if it still has the price the caller saw, so two changes never overwrite each
   * other without anyone noticing. It does not open a transaction: the caller writes the audit entry and the operation to
   * send in the same one.
   *
   * @param id the UUIDv7 of the product
   * @param expectedUnitPriceE4 the price the caller believes the product has
   * @param newUnitPriceE4 the new price with VAT included, in ten-thousandths of a peso
   * @returns true if the product had that price and now has the new one
   */
  replaceUnitPrice(id: string, expectedUnitPriceE4: number, newUnitPriceE4: number): boolean {
    return Number(this.#updatePrice.run(newUnitPriceE4, this.#tenantId, id, expectedUnitPriceE4).changes) === 1;
  }

  /**
   * Finds a product by its id, to price a sale with the catalog instead of with what the screen says.
   *
   * @param id the UUIDv7 of the product
   * @param options `includeInactive` also finds a product that was given up, for the product screens
   * @returns the product, or null if this business has no product with that id, or it was given up and the options do not ask for it
   */
  findById(id: string, options: LookupOptions = {}): CatalogProduct | null {
    const statement = options.includeInactive === true ? this.#findByIdAny : this.#findById;
    const row = statement.get(this.#tenantId, id) as unknown as ProductRow | undefined;
    return row === undefined ? null : toCatalogProduct(row);
  }

  /**
   * Finds the product that has exactly this barcode.
   *
   * @param code the barcode. Spaces around it are ignored.
   * @param options `includeInactive` also finds a product that was given up, for the product screens
   * @returns the product, or null if no product of this business has that code
   */
  findByCode(code: string, options: LookupOptions = {}): CatalogProduct | null {
    const statement = options.includeInactive === true ? this.#findByCodeAny : this.#findByCode;
    const row = statement.get(this.#tenantId, code.trim()) as unknown as ProductRow | undefined;
    return row === undefined ? null : toCatalogProduct(row);
  }

  /**
   * Finds products whose names contain words that start with each word of the text.
   *
   * @param text what the cashier typed
   * @param limit the most products to return
   * @param options `includeInactive` also lists the products that were given up, for the product screens
   * @returns the best matches first, or an empty list if the text has nothing to search for
   */
  search(text: string, limit: number, options: LookupOptions = {}): CatalogProduct[] {
    const query = toPrefixQuery(text);
    if (query === null) {
      return [];
    }
    const statement = options.includeInactive === true ? this.#searchByNameAny : this.#searchByName;
    const rows = statement.all(query, this.#tenantId, limit) as unknown as ProductRow[];
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
