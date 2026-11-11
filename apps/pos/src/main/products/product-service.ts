import type { StatementSync } from 'node:sqlite';

import { formatUnitPriceE4, isUnit, quantityOf } from '@pos-saas/money';

import { MAX_UNIT_PRICE_E4 } from '../../shared/pricing';
import {
  formatUnitCost,
  isValidTaxRate,
  MAX_UNIT_COST_E6,
  problemWithBarcodes,
  problemWithName,
  type CreateProductResult,
  type NewProductRequest,
} from '../../shared/product-admin';
import type { AuditLog } from '../audit/audit-log';
import type { AuthService } from '../auth/auth-service';
import { isRefusal, OwnerGate } from '../auth/owner-gate';
import { StockStore } from '../inventory/stock-store';
import type { LocalStore } from '../local-store/local-store';
import { SyncOutbox } from '../sync/sync-outbox';
import { uuidV7 } from '../uuid-v7';
import { ProductReader } from './product-reader';

/** The source of the opening balance a new product starts with, so a product never posts it twice. */
export const NEW_PRODUCT_STOCK_SOURCE = 'product_creation';

/**
 * Adds products to the catalog from the register itself (E1-42, ADR 0057): what a customer brings that the catalog imported
 * from Eleventa does not have. The owner does it with their session, and a cashier with the PIN of an owner. The product,
 * its barcodes, its first stock as a movement of the ledger, the entry of the audit log and the operation for the core are
 * written in one transaction, so none of them can exist without the others. The product gets its UUIDv7 here, so it exists
 * and can be sold with no internet.
 */
export class ProductService {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  readonly #auth: Pick<AuthService, 'currentUser' | 'authorizeWithOwnerPin'>;
  readonly #audit: Pick<AuditLog, 'record'>;
  readonly #gate: OwnerGate;
  readonly #stock: StockStore;
  readonly #outbox: SyncOutbox;
  readonly #reader: ProductReader;
  readonly #insertProduct: StatementSync;
  readonly #insertBarcode: StatementSync;

  /**
   * @param store the open local database
   * @param tenantId the business
   * @param auth who is signed in, and who can approve with a PIN
   * @param audit the audit log
   * @param reader reads the products whole
   */
  constructor(
    store: LocalStore,
    tenantId: string,
    auth: Pick<AuthService, 'currentUser' | 'authorizeWithOwnerPin'>,
    audit: Pick<AuditLog, 'record'>,
    reader: ProductReader,
  ) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#auth = auth;
    this.#audit = audit;
    this.#gate = new OwnerGate(auth, audit);
    this.#stock = new StockStore(store, tenantId);
    this.#outbox = new SyncOutbox(store, tenantId);
    this.#reader = reader;
    this.#insertProduct = store.prepare(`
      INSERT INTO product (id, tenant_id, name, base_unit, unit_price_e4, tax_factor, tax_rate_bp, unit_cost_e6, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.#insertBarcode = store.prepare('INSERT INTO product_barcode (tenant_id, code, product_id) VALUES (?, ?, ?)');
  }

  /**
   * Adds a product to the catalog.
   *
   * @param request what the form collected, with the PIN of an owner when a cashier asks
   * @returns `created` with the product, or why nothing was written. A code that another product already has, a wrong PIN, a
   *   lock and a missing PIN are answers, and the last three are written in the audit log.
   * @throws Error if nobody is signed in
   * @throws RangeError if the request breaks a rule the screen checks too, such as an empty name or a price of zero
   */
  create(request: NewProductRequest): CreateProductResult {
    const user = this.#auth.currentUser();
    if (user === null) {
      throw new Error('Adding a product needs a person signed in');
    }
    const codes = request.barcodes.map((code) => code.trim());
    assertValidNewProduct(request, codes);
    const name = request.name.trim();

    for (const code of codes) {
      const owner = this.#reader.codeOwner(code);
      if (owner !== null) {
        return { status: 'duplicate_code', code, ...owner };
      }
    }
    const approval = this.#gate.authorize({
      user,
      ownerPin: request.ownerPin,
      deniedAction: 'product.create_denied',
      entity: 'product',
      entityId: 'new',
      deniedDetail: `tried to add ${name} at ${request.unitPriceE4} ten-thousandths`,
    });
    if (isRefusal(approval)) {
      return approval;
    }

    const productId = uuidV7();
    const occurredAt = new Date().toISOString();
    this.#store.transaction(() => {
      this.#insertProduct.run(
        productId,
        this.#tenantId,
        name,
        request.unit,
        request.unitPriceE4,
        request.taxRate.factor,
        request.taxRate.rateBp,
        request.unitCostE6,
        request.isActive ? 1 : 0,
      );
      for (const code of codes) {
        this.#insertBarcode.run(this.#tenantId, code, productId);
      }
      // The stock is a movement of the ledger, never a number written on the product (ADR 0031). One product posts it once.
      if (request.initialStockMilli !== null) {
        this.#stock.postWithinTransaction([
          {
            productId,
            type: 'opening_balance',
            quantityMilli: request.initialStockMilli,
            ...(request.unitCostE6 === null ? {} : { unitCostE6: request.unitCostE6 }),
            source: NEW_PRODUCT_STOCK_SOURCE,
            sourceId: productId,
          },
        ]);
      }
      this.#audit.record({
        userId: user.id,
        action: 'product.create',
        entity: 'product',
        entityId: productId,
        detail: describeNewProduct(name, request, codes, approval.ownerId),
      });
      this.#outbox.enqueue(
        'product.created',
        {
          productId,
          name,
          unit: request.unit,
          unitPriceE4: request.unitPriceE4,
          taxFactor: request.taxRate.factor,
          taxRateBp: request.taxRate.rateBp,
          unitCostE6: request.unitCostE6,
          barcodes: codes,
          isActive: request.isActive,
          initialStock:
            request.initialStockMilli === null ? null : { quantityMilli: request.initialStockMilli, unitCostE6: request.unitCostE6 },
          createdBy: user.id,
          authorizedBy: approval.ownerId,
        },
        occurredAt,
      );
    });
    return { status: 'created', product: this.#reader.detail(productId)! };
  }
}

/** Checks, again in the main process, what the form already checked: the database must not depend on the screen being right. */
function assertValidNewProduct(request: NewProductRequest, codes: readonly string[]): void {
  const problem = problemWithName(request.name) ?? problemWithBarcodes(codes);
  if (problem !== null) {
    throw new RangeError(`Invalid product: ${problem}`);
  }
  if (!isUnit(request.unit)) {
    throw new RangeError('The unit must be piece, meter, kilogram or liter');
  }
  if (!Number.isSafeInteger(request.unitPriceE4) || request.unitPriceE4 <= 0 || request.unitPriceE4 > MAX_UNIT_PRICE_E4) {
    throw new RangeError(`The price must be a whole number of ten-thousandths above zero and up to ${MAX_UNIT_PRICE_E4}`);
  }
  if (!isValidTaxRate(request.taxRate)) {
    throw new RangeError('The VAT rate is not valid');
  }
  if (request.unitCostE6 !== null && (!Number.isSafeInteger(request.unitCostE6) || request.unitCostE6 < 0 || request.unitCostE6 > MAX_UNIT_COST_E6)) {
    throw new RangeError(`The cost must be null or a whole number of millionths from 0 up to ${MAX_UNIT_COST_E6}`);
  }
  if (request.initialStockMilli !== null) {
    if (request.initialStockMilli <= 0) {
      throw new RangeError('The initial stock must be above zero, or null to start with nothing');
    }
    // Throws if the quantity is not a whole number of thousandths, or is a fraction of a piece.
    quantityOf(request.initialStockMilli, request.unit);
  }
}

function describeNewProduct(name: string, request: NewProductRequest, codes: readonly string[], ownerId: string): string {
  const tax = request.taxRate.factor === 'exempt' ? 'exempt' : `${request.taxRate.rateBp} basis points`;
  const cost = request.unitCostE6 === null ? 'no cost' : `cost ${formatUnitCost(request.unitCostE6)}`;
  const stock = request.initialStockMilli === null ? 'no initial stock' : `initial stock ${request.initialStockMilli} thousandths`;
  return `${name}: ${request.unit}, ${formatUnitPriceE4(request.unitPriceE4)} with VAT included (${request.unitPriceE4} ten-thousandths), VAT ${tax}, ${cost}, codes [${codes.join(', ')}], ${stock}, ${request.isActive ? 'active' : 'inactive'}; approved by ${ownerId}`;
}
