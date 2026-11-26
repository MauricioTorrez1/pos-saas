import type { StatementSync } from 'node:sqlite';

import type { TaxFactor, Unit } from '@pos-saas/money';

import type { GivenUpProduct, ProductDetail } from '../../shared/product-admin';
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

interface GivenUpRow {
  readonly id: string;
  readonly name: string;
  readonly base_unit: Unit;
  readonly given_up_at: string | null;
  readonly given_up_by_name: string | null;
  readonly unit_price_e4: number;
  readonly effective_cost_e6: number | null;
  readonly stock_milli: number;
}

/** The most given-up products the screen lists. */
const GIVEN_UP_LIMIT = 500;

/** The cost the margin is worked out with: the one the owner typed, or else the last one of the ledger. */
const EFFECTIVE_COST = `
  coalesce(
    product.unit_cost_e6,
    (SELECT unit_cost_e6 FROM stock_movement
     WHERE tenant_id = product.tenant_id AND product_id = product.id AND unit_cost_e6 IS NOT NULL ORDER BY rowid DESC LIMIT 1)
  )`;

/** The stock, summed from the ledger every time: it is never a column (ADR 0003). */
const STOCK = '(SELECT coalesce(sum(quantity_milli), 0) FROM stock_movement WHERE tenant_id = product.tenant_id AND product_id = product.id)';

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
  readonly #isActive: StatementSync;
  readonly #releasedCodes: StatementSync;
  readonly #givenUp: StatementSync;
  readonly #activeNameOwner: StatementSync;

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
        ${EFFECTIVE_COST} AS effective_cost_e6,
        ${STOCK} AS stock_milli,
        (SELECT count(*) FROM stock_movement WHERE tenant_id = product.tenant_id AND product_id = product.id) AS movement_count
      FROM product
      WHERE product.tenant_id = ? AND product.id = ?
    `);
    this.#barcodes = store.prepare('SELECT code FROM product_barcode WHERE tenant_id = ? AND product_id = ? ORDER BY code');
    this.#isActive = store.prepare('SELECT is_active AS isActive FROM product WHERE tenant_id = ? AND id = ?');
    // A code released more than once by the same product is listed once.
    this.#releasedCodes = store.prepare(`
      SELECT DISTINCT code FROM product_code_history WHERE tenant_id = ? AND product_id = ? AND restored_at IS NULL ORDER BY code
    `);
    this.#givenUp = store.prepare(`
      SELECT
        product.id, product.name, product.base_unit, product.given_up_at, product.unit_price_e4,
        (SELECT name FROM app_user WHERE app_user.id = product.given_up_by) AS given_up_by_name,
        ${EFFECTIVE_COST} AS effective_cost_e6,
        ${STOCK} AS stock_milli
      FROM product
      WHERE product.tenant_id = ? AND product.is_active = 0
      ORDER BY product.given_up_at IS NULL, product.given_up_at DESC, product.name
      LIMIT ${GIVEN_UP_LIMIT}
    `);
    // SQLite folds the case of English letters only, so the length narrows the candidates and the comparison runs in code.
    this.#activeNameOwner = store.prepare(`
      SELECT id AS productId, name AS productName FROM product
      WHERE tenant_id = ? AND is_active = 1 AND id <> ? AND length(trim(name)) = length(?)
      ORDER BY name
    `);
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
      releasedCodes: this.releasedCodes(productId),
      stockMilli: row.stock_milli,
      movementCount: row.movement_count,
    };
  }

  /**
   * Tells whether a product can be sold.
   *
   * @param productId the UUIDv7 of the product
   * @returns true if the product exists and was not given up
   */
  isActive(productId: string): boolean {
    const row = this.#isActive.get(this.#tenantId, productId) as unknown as { isActive: number } | undefined;
    return row?.isActive === 1;
  }

  /**
   * Lists the codes a product released when it was given up and has not got back (ADR 0084).
   *
   * @param productId the UUIDv7 of the product
   * @returns the codes, sorted, each once
   */
  releasedCodes(productId: string): string[] {
    return (this.#releasedCodes.all(this.#tenantId, productId) as unknown as { code: string }[]).map(({ code }) => code);
  }

  /**
   * Lists the products that were given up, the latest first, with who did it, their last price and cost, the stock that is
   * left and the codes they released (E1-62).
   *
   * @returns at most 500 products; the ones with no known date go last
   */
  givenUp(): GivenUpProduct[] {
    const rows = this.#givenUp.all(this.#tenantId) as unknown as GivenUpRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      unit: row.base_unit,
      givenUpAt: row.given_up_at,
      givenUpByName: row.given_up_by_name,
      unitPriceE4: row.unit_price_e4,
      effectiveCostE6: row.effective_cost_e6,
      stockMilli: row.stock_milli,
      releasedCodes: this.releasedCodes(row.id),
    }));
  }

  /**
   * Finds another active product with the same name, ignoring the case and the spaces around it.
   *
   * @param name the name to look for
   * @param exceptProductId the product that does not count against itself
   * @returns the product that has the name, or null if no other active product has it
   */
  activeNameOwner(name: string, exceptProductId: string): CodeOwner | null {
    const wanted = foldName(name);
    const candidates = this.#activeNameOwner.all(this.#tenantId, exceptProductId, name.trim()) as unknown as CodeOwner[];
    return candidates.find((candidate) => foldName(candidate.productName) === wanted) ?? null;
  }

  /**
   * Finds the product that uses a barcode now. A product that was given up released its codes (ADR 0084), so the owner is
   * an active product, or a product that was made inactive from its creation and never sold.
   *
   * @param code the barcode, as typed or scanned. Spaces around it are ignored.
   * @returns the product that has it, or null if the code is free
   */
  codeOwner(code: string): CodeOwner | null {
    const row = this.#codeOwner.get(this.#tenantId, code.trim()) as unknown as CodeOwner | undefined;
    return row ?? null;
  }
}

/** A name as two names are compared: without the spaces around it and in lower case, the Spanish way (É is é). */
function foldName(name: string): string {
  return name.trim().toLocaleLowerCase('es-MX');
}
