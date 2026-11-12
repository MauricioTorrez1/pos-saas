import type { StatementSync } from 'node:sqlite';

import { formatUnitPriceE4, isUnit, quantityOf, type TaxRate, type Unit } from '@pos-saas/money';

import { MAX_UNIT_PRICE_E4 } from '../../shared/pricing';
import {
  formatUnitCost,
  isValidTaxRate,
  MAX_UNIT_COST_E6,
  problemWithBarcodes,
  problemWithName,
  type CreateProductResult,
  type NewProductRequest,
  type ProductDetail,
  type ProductPanelDetail,
  type ProductSummary,
  type UpdateProductRequest,
  type UpdateProductResult,
} from '../../shared/product-admin';
import type { AuditLog } from '../audit/audit-log';
import type { AuthService } from '../auth/auth-service';
import { isRefusal, OwnerGate } from '../auth/owner-gate';
import type { InventoryService } from '../inventory/inventory-service';
import { StockStore } from '../inventory/stock-store';
import type { LocalStore } from '../local-store/local-store';
import type { ProductCatalog } from '../local-store/product-catalog';
import { SyncOutbox } from '../sync/sync-outbox';
import { uuidV7 } from '../uuid-v7';
import { ProductReader } from './product-reader';

/** The most products a search of the panel lists. */
const PANEL_SEARCH_LIMIT = 20;
/** The most movements the panel shows under a product. */
const PANEL_MOVEMENTS = 10;

/** The source of the opening balance a new product starts with, so a product never posts it twice. */
export const NEW_PRODUCT_STOCK_SOURCE = 'product_creation';

/**
 * Adds products to the catalog from the register itself (E1-42, ADR 0057) and edits them (E1-43, ADR 0058): what a customer brings that the catalog imported
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
  readonly #catalog: ProductCatalog;
  readonly #movements: Pick<InventoryService, 'kardex'>;
  readonly #insertProduct: StatementSync;
  readonly #insertBarcode: StatementSync;
  readonly #deleteBarcode: StatementSync;
  readonly #updateProduct: StatementSync;

  /**
   * @param store the open local database
   * @param tenantId the business
   * @param auth who is signed in, and who can approve with a PIN
   * @param audit the audit log
   * @param reader reads the products whole
   * @param catalog finds products, the given up ones too when asked
   * @param movements reads the latest movements of a product
   */
  constructor(
    store: LocalStore,
    tenantId: string,
    auth: Pick<AuthService, 'currentUser' | 'authorizeWithOwnerPin'>,
    audit: Pick<AuditLog, 'record'>,
    reader: ProductReader,
    catalog: ProductCatalog,
    movements: Pick<InventoryService, 'kardex'>,
  ) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#auth = auth;
    this.#audit = audit;
    this.#gate = new OwnerGate(auth, audit);
    this.#stock = new StockStore(store, tenantId);
    this.#outbox = new SyncOutbox(store, tenantId);
    this.#reader = reader;
    this.#catalog = catalog;
    this.#movements = movements;
    this.#insertProduct = store.prepare(`
      INSERT INTO product (id, tenant_id, name, base_unit, unit_price_e4, tax_factor, tax_rate_bp, unit_cost_e6, is_active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.#insertBarcode = store.prepare('INSERT INTO product_barcode (tenant_id, code, product_id) VALUES (?, ?, ?)');
    this.#deleteBarcode = store.prepare('DELETE FROM product_barcode WHERE tenant_id = ? AND code = ? AND product_id = ?');
    // Every edited column is set, changed or not: the trigger of the revision fires on the columns of the SET, so the
    // revision goes up with every save, even one that only adds a barcode. The guard on the revision is the optimistic lock.
    this.#updateProduct = store.prepare(`
      UPDATE product
      SET name = ?, base_unit = ?, tax_factor = ?, tax_rate_bp = ?, unit_cost_e6 = ?, is_active = ?
      WHERE tenant_id = ? AND id = ? AND revision = ?
    `);
  }

  /**
   * Finds products by a barcode or by the start of the words of their name, including the ones that were given up.
   *
   * @param text what was typed or scanned
   * @returns the best matches first, at most 20
   */
  find(text: string): ProductSummary[] {
    const exact = this.#catalog.findByCode(text, { includeInactive: true });
    const found = exact === null ? this.#catalog.search(text, PANEL_SEARCH_LIMIT, { includeInactive: true }) : [exact];
    return found.map(({ id, name, unit, unitPriceE4 }) => ({ id, name, unit, unitPriceE4, isActive: this.#reader.isActive(id) }));
  }

  /**
   * Reads a product with its latest movements, active or not.
   *
   * @param productId the UUIDv7 of the product
   * @returns the product, or null if it does not exist
   */
  panelDetail(productId: string): ProductPanelDetail | null {
    const detail = this.#reader.detail(productId);
    if (detail === null) {
      return null;
    }
    return { ...detail, recentMovements: this.#movements.kardex(productId)?.rows.slice(0, PANEL_MOVEMENTS) ?? [] };
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

  /**
   * Saves the changes of a product: name, barcodes, unit, VAT, cost and state (E1-43, ADR 0058). The price and the stock are
   * not here, because they have their own flows (`PriceChangeService` and `InventoryService`).
   *
   * @param request what the product should be, with the revision the screen saw and the PIN when a cashier asks
   * @returns `updated` with the product as it is now, or why nothing was written: `stale` if the product changed after the
   *   screen loaded it, `unit_locked` if the unit cannot change, `duplicate_code`, or a refusal of the owner's approval (which
   *   is written in the audit log). Asking for what the product already is answers `unchanged` and writes nothing.
   * @throws Error if nobody is signed in
   * @throws RangeError if the request breaks a rule the screen checks too, such as an empty name
   */
  update(request: UpdateProductRequest): UpdateProductResult {
    const user = this.#auth.currentUser();
    if (user === null) {
      throw new Error('Editing a product needs a person signed in');
    }
    const codes = request.barcodes.map((code) => code.trim());
    assertValidEdit(request, codes);
    const name = request.name.trim();

    const current = this.#reader.detail(request.productId);
    if (current === null) {
      return { status: 'not_found' };
    }
    if (current.revision !== request.expectedRevision) {
      return { status: 'stale', product: this.panelDetail(request.productId)! };
    }
    const changes = diffProduct(current, { name, unit: request.unit, taxRate: request.taxRate, unitCostE6: request.unitCostE6, isActive: request.isActive, codes });
    if (changes === null) {
      return { status: 'unchanged', product: this.panelDetail(request.productId)! };
    }
    if (changes.unit !== undefined && current.movementCount > 0) {
      return { status: 'unit_locked', movementCount: current.movementCount };
    }
    for (const code of changes.barcodesAdded ?? []) {
      const owner = this.#reader.codeOwner(code);
      if (owner !== null && owner.productId !== current.id) {
        return { status: 'duplicate_code', code, ...owner };
      }
    }
    const approval = this.#gate.authorize({
      user,
      ownerPin: request.ownerPin,
      deniedAction: 'product.update_denied',
      entity: 'product',
      entityId: current.id,
      deniedDetail: `tried to edit ${current.name}: ${describeChanges(changes)}`,
    });
    if (isRefusal(approval)) {
      return approval;
    }

    const occurredAt = new Date().toISOString();
    this.#store.transaction(() => {
      const written = this.#updateProduct.run(
        name,
        request.unit,
        request.taxRate.factor,
        request.taxRate.rateBp,
        request.unitCostE6,
        request.isActive ? 1 : 0,
        this.#tenantId,
        current.id,
        request.expectedRevision,
      );
      if (Number(written.changes) !== 1) {
        throw new Error('The product changed while it was being saved');
      }
      for (const code of changes.barcodesRemoved ?? []) {
        this.#deleteBarcode.run(this.#tenantId, code, current.id);
      }
      for (const code of changes.barcodesAdded ?? []) {
        this.#insertBarcode.run(this.#tenantId, code, current.id);
      }
      this.#audit.record({
        userId: user.id,
        action: 'product.update',
        entity: 'product',
        entityId: current.id,
        detail: `${current.name}: ${describeChanges(changes)}; approved by ${approval.ownerId}`,
      });
      this.#outbox.enqueue(
        'product.updated',
        { changeId: uuidV7(), productId: current.id, changes: toWireChanges(changes), changedBy: user.id, authorizedBy: approval.ownerId },
        occurredAt,
      );
    });
    return { status: 'updated', product: this.panelDetail(current.id)! };
  }
}

/** The fields of a product that the panel edits, as they are asked for. */
interface EditedProduct {
  readonly name: string;
  readonly unit: Unit;
  readonly taxRate: TaxRate;
  readonly unitCostE6: number | null;
  readonly isActive: boolean;
  readonly codes: readonly string[];
}

/** A field that changed, with the value it had and the value it has now. */
interface Change<Value> {
  readonly previous: Value;
  readonly new: Value;
}

/** What changed in a product. A field that did not change is absent. */
interface ProductChanges {
  readonly name?: Change<string>;
  readonly unit?: Change<Unit>;
  readonly tax?: Change<TaxRate>;
  readonly unitCostE6?: Change<number | null>;
  readonly isActive?: Change<boolean>;
  readonly barcodesAdded?: readonly string[];
  readonly barcodesRemoved?: readonly string[];
}

/** Compares what the product is with what it should be. Returns null when nothing differs. */
function diffProduct(current: ProductDetail, wanted: EditedProduct): ProductChanges | null {
  const added = wanted.codes.filter((code) => !current.barcodes.includes(code));
  const removed = current.barcodes.filter((code) => !wanted.codes.includes(code));
  const changes: ProductChanges = {
    ...(current.name === wanted.name ? {} : { name: { previous: current.name, new: wanted.name } }),
    ...(current.unit === wanted.unit ? {} : { unit: { previous: current.unit, new: wanted.unit } }),
    ...(current.taxRate.factor === wanted.taxRate.factor && current.taxRate.rateBp === wanted.taxRate.rateBp
      ? {}
      : { tax: { previous: current.taxRate, new: wanted.taxRate } }),
    ...(current.unitCostE6 === wanted.unitCostE6 ? {} : { unitCostE6: { previous: current.unitCostE6, new: wanted.unitCostE6 } }),
    ...(current.isActive === wanted.isActive ? {} : { isActive: { previous: current.isActive, new: wanted.isActive } }),
    ...(added.length === 0 ? {} : { barcodesAdded: added }),
    ...(removed.length === 0 ? {} : { barcodesRemoved: removed }),
  };
  return Object.keys(changes).length === 0 ? null : changes;
}

/** The changes as the contract with the core writes them: the VAT as its two fields. */
function toWireChanges(changes: ProductChanges): Record<string, unknown> {
  const { tax, ...rest } = changes;
  return {
    ...rest,
    ...(tax === undefined
      ? {}
      : {
          tax: {
            previous: { taxFactor: tax.previous.factor, taxRateBp: tax.previous.rateBp },
            new: { taxFactor: tax.new.factor, taxRateBp: tax.new.rateBp },
          },
        }),
  };
}

function describeTax({ factor, rateBp }: TaxRate): string {
  return factor === 'exempt' ? 'exempt' : `${rateBp} basis points`;
}

function describeCost(unitCostE6: number | null): string {
  return unitCostE6 === null ? 'no cost' : formatUnitCost(unitCostE6);
}

/** The old and new value of every field that changed, in plain text, so a person can read the audit log later. */
function describeChanges(changes: ProductChanges): string {
  const parts: string[] = [];
  if (changes.name !== undefined) {
    parts.push(`name "${changes.name.previous}" -> "${changes.name.new}"`);
  }
  if (changes.unit !== undefined) {
    parts.push(`unit ${changes.unit.previous} -> ${changes.unit.new}`);
  }
  if (changes.tax !== undefined) {
    parts.push(`VAT ${describeTax(changes.tax.previous)} -> ${describeTax(changes.tax.new)}`);
  }
  if (changes.unitCostE6 !== undefined) {
    parts.push(`cost ${describeCost(changes.unitCostE6.previous)} -> ${describeCost(changes.unitCostE6.new)}`);
  }
  if (changes.isActive !== undefined) {
    parts.push(`state ${changes.isActive.previous ? 'active' : 'inactive'} -> ${changes.isActive.new ? 'active' : 'inactive'}`);
  }
  if (changes.barcodesAdded !== undefined) {
    parts.push(`codes added [${changes.barcodesAdded.join(', ')}]`);
  }
  if (changes.barcodesRemoved !== undefined) {
    parts.push(`codes removed [${changes.barcodesRemoved.join(', ')}]`);
  }
  return parts.join('; ');
}

/** Checks, again in the main process, what the panel already checked. */
function assertValidEdit(request: UpdateProductRequest, codes: readonly string[]): void {
  const problem = problemWithName(request.name) ?? problemWithBarcodes(codes);
  if (problem !== null) {
    throw new RangeError(`Invalid product: ${problem}`);
  }
  if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 1) {
    throw new RangeError('The revision must be a whole number of 1 or more');
  }
  if (!isUnit(request.unit)) {
    throw new RangeError('The unit must be piece, meter, kilogram or liter');
  }
  if (!isValidTaxRate(request.taxRate)) {
    throw new RangeError('The VAT rate is not valid');
  }
  if (request.unitCostE6 !== null && (!Number.isSafeInteger(request.unitCostE6) || request.unitCostE6 < 0 || request.unitCostE6 > MAX_UNIT_COST_E6)) {
    throw new RangeError(`The cost must be null or a whole number of millionths from 0 up to ${MAX_UNIT_COST_E6}`);
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
