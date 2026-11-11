import type { StatementSync } from 'node:sqlite';

import type { TaxFactor, Unit } from '@pos-saas/money';

import type { ProductDetail } from '../../shared/product-admin';
import type { LocalStore } from '../local-store/local-store';

interface ProductDetailRow {
  readonly id: string;
  readonly name: string;
  readonly base_unit: Unit;
  readonly unit_price_e4: number;
  readonly tax_factor: TaxFactor;
  readonly tax_rate_bp: number;
  readonly unit_cost_e6: number | null;
  readonly is_active: number;
  readonly revision: number;
  readonly effective_cost_e6: number | null;
  readonly stock_milli: number;
  readonly movement_count: number;
}

/** The product that owns a barcode. */
export interface CodeOwner {
  readonly productId: string;
  readonly productName: string;
}

/**
 * Reads products whole for the product screens: cost, state, barcodes and stock, including the products that were given
 * up. The sale never uses it, because it only needs the price and the tax of an active product (`ProductCatalog`).
 */
export class ProductReader {
  readonly #tenantId: string;
  readonly #detail: StatementSync;
  readonly #barcodes: StatementSync;
  readonly #codeOwner: StatementSync;

  /**
   * @param store the open local database
   * @param tenantId the business whose products this reader sees
   */
  constructor(store: LocalStore, tenantId: string) {
    this.#tenantId = tenantId;
    // The stock is summed from the ledger every time: it is never a column (ADR 0003). The cost the owner typed wins over
    // the last cost of the ledger.
    this.#detail = store.prepare(`
      SELECT
        product.id, product.name, product.base_unit, product.unit_price_e4, product.tax_factor, product.tax_rate_bp,
        product.unit_cost_e6, product.is_active, product.revision,
        coalesce(
          product.unit_cost_e6,
          (SELECT unit_cost_e6 FROM stock_movement
           WHERE tenant_id = product.tenant_id AND product_id = product.id AND unit_cost_e6 IS NOT NULL ORDER BY rowid DESC LIMIT 1)
        ) AS effective_cost_e6,
        (SELECT coalesce(sum(quantity_milli), 0) FROM stock_movement WHERE tenant_id = product.tenant_id AND product_id = product.id) AS stock_milli,
        (SELECT count(*) FROM stock_movement WHERE tenant_id = product.tenant_id AND product_id = product.id) AS movement_count
      FROM product
      WHERE product.tenant_id = ? AND product.id = ?
    `);
    this.#barcodes = store.prepare('SELECT code FROM product_barcode WHERE tenant_id = ? AND product_id = ? ORDER BY code');
    this.#codeOwner = store.prepare(`
      SELECT product.id AS productId, product.name AS productName
      FROM product_barcode JOIN product ON product.id = product_barcode.product_id
      WHERE product_barcode.tenant_id = ? AND product_barcode.code = ?
    `);
  }

  /**
   * Reads a product with everything the product screens show.
   *
   * @param productId the UUIDv7 of the product
   * @returns the product, active or not, or null if this business has none with that id
   */
  detail(productId: string): ProductDetail | null {
    const row = this.#detail.get(this.#tenantId, productId) as unknown as ProductDetailRow | undefined;
    if (row === undefined) {
      return null;
    }
    const barcodes = this.#barcodes.all(this.#tenantId, productId) as unknown as { code: string }[];
    return {
      id: row.id,
      name: row.name,
      unit: row.base_unit,
      unitPriceE4: row.unit_price_e4,
      taxRate: { factor: row.tax_factor, rateBp: row.tax_rate_bp },
      unitCostE6: row.unit_cost_e6,
      effectiveCostE6: row.effective_cost_e6,
      isActive: row.is_active === 1,
      revision: row.revision,
      barcodes: barcodes.map(({ code }) => code),
      stockMilli: row.stock_milli,
      movementCount: row.movement_count,
    };
  }

  /**
   * Finds the product that already uses a barcode, active or not: a code of a product that was given up stays taken.
   *
   * @param code the barcode, as typed or scanned. Spaces around it are ignored.
   * @returns the product that has it, or null if the code is free
   */
  codeOwner(code: string): CodeOwner | null {
    const row = this.#codeOwner.get(this.#tenantId, code.trim()) as unknown as CodeOwner | undefined;
    return row ?? null;
  }
}
