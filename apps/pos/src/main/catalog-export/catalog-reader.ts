import type { TaxFactor, Unit } from '@pos-saas/money';

import type { LocalStore } from '../local-store/local-store';
import { averageCostE6, type CostedEntry } from '../reports/average-cost';
import type { CatalogProductRecord, SupplierCode } from './catalog-rows';

interface ProductRow {
  readonly id: string;
  readonly name: string;
  readonly unit: Unit;
  readonly unitPriceE4: number;
  readonly taxFactor: TaxFactor;
  readonly taxRateBp: number;
  readonly isActive: number;
  readonly typedCostE6: number | null;
}

function groupBy<Item, Value>(items: readonly Item[], keyOf: (item: Item) => string, valueOf: (item: Item) => Value): Map<string, Value[]> {
  const groups = new Map<string, Value[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [valueOf(item)]);
    } else {
      group.push(valueOf(item));
    }
  }
  return groups;
}

/**
 * Reads the whole catalog for the export in five queries, whatever its size: the products, their barcodes, their
 * suppliers, the stock the ledger adds up to, and the entries with a cost for the weighted average. Nothing is read once
 * per product, so 5,000 products cost the same five queries as 5.
 */
export class CatalogReader {
  readonly #store: LocalStore;
  readonly #tenantId: string;

  /**
   * @param store the open local database
   * @param tenantId the business whose catalog this is
   */
  constructor(store: LocalStore, tenantId: string) {
    this.#store = store;
    this.#tenantId = tenantId;
  }

  /**
   * Reads every product, sorted by name.
   *
   * @param activeOnly true leaves out the products that were given up
   * @returns the products with their codes, suppliers, cost and stock
   */
  read(activeOnly: boolean): CatalogProductRecord[] {
    const tenant = this.#tenantId;
    const products = this.#store
      .prepare(
        `SELECT id, name, base_unit AS unit, unit_price_e4 AS unitPriceE4, tax_factor AS taxFactor, tax_rate_bp AS taxRateBp,
                is_active AS isActive, unit_cost_e6 AS typedCostE6
         FROM product WHERE tenant_id = ? ${activeOnly ? 'AND is_active = 1' : ''}
         ORDER BY name COLLATE NOCASE, id`,
      )
      .all(tenant) as unknown as ProductRow[];
    const barcodes = groupBy(
      this.#store.prepare('SELECT product_id AS productId, code FROM product_barcode WHERE tenant_id = ? ORDER BY product_id, code').all(tenant) as unknown as {
        productId: string;
        code: string;
      }[],
      (row) => row.productId,
      (row) => row.code,
    );
    const suppliers = groupBy(
      this.#store
        .prepare(
          `SELECT l.product_id AS productId, s.name AS supplierName, l.supplier_code AS supplierCode
           FROM supplier_product_code l JOIN supplier s ON s.id = l.supplier_id AND s.tenant_id = l.tenant_id
           WHERE l.tenant_id = ? ORDER BY l.product_id, s.name COLLATE NOCASE, l.supplier_code`,
        )
        .all(tenant) as unknown as (SupplierCode & { productId: string })[],
      (row) => row.productId,
      (row): SupplierCode => ({ supplierName: row.supplierName, supplierCode: row.supplierCode }),
    );
    const stock = new Map(
      (
        this.#store.prepare('SELECT product_id AS productId, sum(quantity_milli) AS total FROM stock_movement WHERE tenant_id = ? GROUP BY product_id').all(tenant) as unknown as {
          productId: string;
          total: number;
        }[]
      ).map((row) => [row.productId, row.total]),
    );
    const entries = groupBy(this.#costedEntries(), (entry) => entry.productId, (entry): CostedEntry => entry);
    return products.map((product): CatalogProductRecord => {
      const average = product.typedCostE6 === null ? averageCostE6(entries.get(product.id) ?? []) : null;
      const costE6 = product.typedCostE6 ?? average;
      return {
        id: product.id,
        name: product.name,
        unit: product.unit,
        unitPriceE4: product.unitPriceE4,
        taxRate: { factor: product.taxFactor, rateBp: product.taxRateBp },
        isActive: product.isActive === 1,
        barcodes: barcodes.get(product.id) ?? [],
        suppliers: suppliers.get(product.id) ?? [],
        costE6,
        costSource: product.typedCostE6 !== null ? 'typed' : average !== null ? 'average' : 'none',
        stockMilli: stock.get(product.id) ?? 0,
      };
    });
  }

  /**
   * The entries with a cost, each with the stock its product had right before it. A window function adds the stock up in
   * one pass of the ledger, instead of one sum per entry.
   */
  #costedEntries(): (CostedEntry & { readonly productId: string })[] {
    return this.#store
      .prepare(
        `SELECT productId, quantityMilli, unitCostE6, stockBeforeMilli FROM (
           SELECT rowid AS movementRow, product_id AS productId, quantity_milli AS quantityMilli, unit_cost_e6 AS unitCostE6,
                  coalesce(sum(quantity_milli) OVER (PARTITION BY product_id ORDER BY rowid ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS stockBeforeMilli
           FROM stock_movement WHERE tenant_id = ?
         ) WHERE unitCostE6 IS NOT NULL AND quantityMilli > 0
         ORDER BY productId, movementRow`,
      )
      .all(this.#tenantId) as unknown as (CostedEntry & { productId: string })[];
  }
}
