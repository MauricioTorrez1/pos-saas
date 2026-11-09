import type { StatementSync } from 'node:sqlite';

import type { LocalStore } from '../local-store/local-store';
import type { StockStore, StockMovementToPost } from '../inventory/stock-store';
import { uuidV7 } from '../uuid-v7';
import type { CatalogRow, InvalidRow } from './eleventa-csv';

/** What loading a file did, so the owner can compare it with Eleventa before trusting it. */
export interface ImportReport {
  readonly rowsRead: number;
  readonly created: number;
  /** Products whose code was already in the register, so nothing was changed. */
  readonly alreadyThere: number;
  /** Opening balances posted. A product that was already there posts none the second time. */
  readonly openingBalances: number;
  /** The cost of the stock that was loaded, in cents, to compare with the inventory report of Eleventa. */
  readonly inventoryValueCents: number;
  /** Sample products removed, because the real catalog replaces them. */
  readonly samplesRemoved: number;
  readonly invalid: readonly InvalidRow[];
}

const COST_E6_TO_CENTS_DIVISOR = 10_000n * 1000n;

/**
 * Loads the catalog and the stock of Eleventa into the register (RF-034). It is the starting point, not a sync: a product
 * whose code is already here is left as it is, so loading the same file twice, or a bigger one later, adds only what is
 * new and never counts the stock twice.
 */
export class CatalogImporter {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  readonly #stock: StockStore;
  readonly #findByCode: StatementSync;
  readonly #insertProduct: StatementSync;
  readonly #insertBarcode: StatementSync;
  readonly #deleteSamples: StatementSync;

  /**
   * @param store the open local database
   * @param tenantId the business whose catalog this loads
   * @param stock where the opening balances are posted
   */
  constructor(store: LocalStore, tenantId: string, stock: StockStore) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#stock = stock;
    this.#findByCode = store.prepare('SELECT product_id FROM product_barcode WHERE tenant_id = ? AND code = ?');
    this.#insertProduct = store.prepare(`
      INSERT INTO product (id, tenant_id, name, base_unit, unit_price_e4, tax_factor, tax_rate_bp) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.#insertBarcode = store.prepare('INSERT INTO product_barcode (tenant_id, code, product_id) VALUES (?, ?, ?)');
    this.#deleteSamples = store.prepare('DELETE FROM product WHERE tenant_id = ? AND is_sample = 1');
  }

  /**
   * Loads what was read from the file. Each product and its opening balance go in one transaction.
   *
   * @param reading the products and the rows that were left out when reading
   * @returns what was loaded
   */
  load(reading: { readonly rows: readonly CatalogRow[]; readonly invalid: readonly InvalidRow[] }): ImportReport {
    let created = 0;
    let alreadyThere = 0;
    let openingBalances = 0;
    let valueE6Milli = 0n;
    for (const row of reading.rows) {
      this.#store.transaction(() => {
        const existing = this.#findByCode.get(this.#tenantId, row.code) as unknown as { product_id: string } | undefined;
        const productId = existing?.product_id ?? this.#create(row);
        if (existing === undefined) {
          created += 1;
        } else {
          alreadyThere += 1;
        }
        const posted = this.#stock.postWithinTransaction(this.#openingBalance(row, productId));
        openingBalances += posted;
        if (posted > 0 && row.stockMilli !== undefined && row.unitCostE6 !== undefined) {
          valueE6Milli += BigInt(row.unitCostE6) * BigInt(row.stockMilli);
        }
      });
    }
    const loaded = created + alreadyThere;
    const samplesRemoved = loaded === 0 ? 0 : this.#removeSamples();
    return {
      rowsRead: reading.rows.length + reading.invalid.length,
      created,
      alreadyThere,
      openingBalances,
      // cost per unit in millionths of a peso times thousandths of a unit, down to cents, rounded half up.
      inventoryValueCents: Number((valueE6Milli * 2n + COST_E6_TO_CENTS_DIVISOR) / (COST_E6_TO_CENTS_DIVISOR * 2n)),
      samplesRemoved,
      invalid: reading.invalid,
    };
  }

  #create(row: CatalogRow): string {
    const id = uuidV7();
    this.#insertProduct.run(id, this.#tenantId, row.name, row.unit, row.unitPriceE4, row.taxRate.factor, row.taxRate.rateBp);
    this.#insertBarcode.run(this.#tenantId, row.code, id);
    return id;
  }

  #openingBalance(row: CatalogRow, productId: string): StockMovementToPost[] {
    if (row.stockMilli === undefined || row.stockMilli === 0) {
      return [];
    }
    return [
      {
        productId,
        type: 'opening_balance',
        quantityMilli: row.stockMilli,
        ...(row.unitCostE6 === undefined ? {} : { unitCostE6: row.unitCostE6 }),
        source: 'import',
        sourceId: row.code,
      },
    ];
  }

  #removeSamples(): number {
    return this.#store.transaction(() => Number(this.#deleteSamples.run(this.#tenantId).changes));
  }
}
