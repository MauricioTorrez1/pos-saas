import type { StatementSync } from 'node:sqlite';

import { quantityOf, type Unit } from '@pos-saas/money';

import {
  MAX_NOTES_LENGTH,
  MAX_ORDER_LINES,
  MAX_ORDER_QUANTITY_MILLI,
  MAX_ORDER_UNIT_COST_E6,
  MAX_REORDER_LEVEL_MILLI,
  MAX_SUPPLIER_CODE_LENGTH,
  formatFolio,
  orderLineCents,
  type DiscardOrderResult,
  type MarkOrderSentResult,
  type OrderActionRequest,
  type OrderCandidate,
  type OrderLine,
  type OrderLineRequest,
  type PurchaseOrder,
  type PurchaseOrderSummary,
  type SaveOrderRequest,
  type SaveOrderResult,
  type SearchOrderProductsRequest,
  type SetReorderLevelRequest,
  type SetReorderLevelResult,
  type SupplierCode,
} from '../../shared/supplier-order';
import type { AuditLog } from '../audit/audit-log';
import type { AuthService } from '../auth/auth-service';
import { isRefusal, OwnerGate } from '../auth/owner-gate';
import type { LocalStore } from '../local-store/local-store';
import type { ProductCatalog } from '../local-store/product-catalog';
import type { ProductReader } from '../products/product-reader';
import { SyncOutbox } from '../sync/sync-outbox';
import { uuidV7 } from '../uuid-v7';
import { optionalText, type SupplierService } from './supplier-service';

/** The most products one search lists. */
const SEARCH_LIMIT = 20;
/** The most products the suggestion lists. */
const SUGGESTION_LIMIT = 100;

interface OrderRow {
  readonly id: string;
  readonly folio: number;
  readonly supplier_id: string;
  readonly supplier_name: string;
  readonly status: 'draft' | 'sent';
  readonly notes: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly sent_at: string | null;
  readonly revision: number;
}

interface LineRow {
  readonly line_number: number;
  readonly product_id: string;
  readonly description: string;
  readonly supplier_code: string | null;
  readonly barcode: string | null;
  readonly unit: Unit;
  readonly quantity_milli: number;
  readonly unit_cost_e6: number | null;
  readonly line_total_cents: number | null;
}

interface SummaryRow {
  readonly id: string;
  readonly folio: number;
  readonly supplier_name: string;
  readonly status: 'draft' | 'sent';
  readonly updated_at: string;
  readonly line_count: number;
  readonly total_cents: number;
}

interface CodeRow {
  readonly supplier_code: string;
  readonly list_cost_e6: number | null;
  readonly purchase_unit: string | null;
}

interface LevelRow {
  readonly minimum_milli: number;
  readonly maximum_milli: number | null;
}

/** A line of a request, checked against its product and ready to be written. */
interface PreparedLine {
  readonly productId: string;
  readonly description: string;
  readonly supplierCode: string | null;
  readonly barcode: string | null;
  readonly unit: Unit;
  readonly quantityMilli: number;
  readonly unitCostE6: number | null;
  readonly lineTotalCents: number | null;
}

/**
 * What to order to get a product back to its reorder level: up to the maximum, or up to twice the minimum when there is no
 * maximum. It is a suggestion the owner can change, and a product with no level, or above its minimum, has none.
 *
 * @param stockMilli what the ledger says there is, which may be negative
 * @param minimumMilli the level that triggers an order, or null if none was set
 * @param maximumMilli the level to fill up to, or null
 * @returns the quantity in thousandths, or null when there is nothing to suggest
 */
export function suggestedQuantity(stockMilli: number, minimumMilli: number | null, maximumMilli: number | null): number | null {
  if (minimumMilli === null || stockMilli > minimumMilli) {
    return null;
  }
  const target = maximumMilli ?? minimumMilli * 2;
  return Math.min(target - stockMilli, MAX_ORDER_QUANTITY_MILLI);
}

/**
 * The purchase order of the register (E1-44, ADR 0059): finding what to order, saving the order as a draft, marking it as
 * sent, and the reorder levels that tell what is low. An order is a document: it never moves the stock, because what arrives
 * is posted by the reception of F2-13. Everything that writes needs the owner, or the PIN of an owner for a cashier, and is
 * written in one transaction with its audit entry (and, when the order is sent, its operation for the core).
 */
export class PurchaseOrderService {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  readonly #auth: Pick<AuthService, 'currentUser' | 'authorizeWithOwnerPin'>;
  readonly #audit: Pick<AuditLog, 'record'>;
  readonly #gate: OwnerGate;
  readonly #outbox: SyncOutbox;
  readonly #suppliers: Pick<SupplierService, 'find'>;
  readonly #reader: ProductReader;
  readonly #catalog: ProductCatalog;
  readonly #orderById: StatementSync;
  readonly #linesOf: StatementSync;
  readonly #summaries: StatementSync;
  readonly #nextFolio: StatementSync;
  readonly #insertOrder: StatementSync;
  readonly #updateDraft: StatementSync;
  readonly #deleteLines: StatementSync;
  readonly #insertLine: StatementSync;
  readonly #markSent: StatementSync;
  readonly #deleteDraft: StatementSync;
  readonly #codesOf: StatementSync;
  readonly #productsByCode: StatementSync;
  readonly #levelOf: StatementSync;
  readonly #lowProducts: StatementSync;
  readonly #supplierHasLinks: StatementSync;
  readonly #productHasCodeOf: StatementSync;
  readonly #upsertLevel: StatementSync;

  /**
   * @param store the open local database
   * @param tenantId the business
   * @param auth who is signed in, and who can approve with a PIN
   * @param audit the audit log
   * @param suppliers reads the suppliers
   * @param reader reads the products whole, with their stock and cost
   * @param catalog finds the products that are sold, by barcode and by name
   */
  constructor(
    store: LocalStore,
    tenantId: string,
    auth: Pick<AuthService, 'currentUser' | 'authorizeWithOwnerPin'>,
    audit: Pick<AuditLog, 'record'>,
    suppliers: Pick<SupplierService, 'find'>,
    reader: ProductReader,
    catalog: ProductCatalog,
  ) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#auth = auth;
    this.#audit = audit;
    this.#gate = new OwnerGate(auth, audit);
    this.#outbox = new SyncOutbox(store, tenantId);
    this.#suppliers = suppliers;
    this.#reader = reader;
    this.#catalog = catalog;
    this.#orderById = store.prepare(`
      SELECT id, folio, supplier_id, supplier_name, status, notes, created_at, updated_at, sent_at, revision
      FROM purchase_order WHERE tenant_id = ? AND id = ?
    `);
    this.#linesOf = store.prepare(`
      SELECT line_number, product_id, description, supplier_code, barcode, unit, quantity_milli, unit_cost_e6, line_total_cents
      FROM purchase_order_line WHERE tenant_id = ? AND order_id = ? ORDER BY line_number
    `);
    this.#summaries = store.prepare(`
      SELECT purchase_order.id, purchase_order.folio, purchase_order.supplier_name, purchase_order.status, purchase_order.updated_at,
        (SELECT count(*) FROM purchase_order_line WHERE order_id = purchase_order.id) AS line_count,
        (SELECT coalesce(sum(line_total_cents), 0) FROM purchase_order_line WHERE order_id = purchase_order.id) AS total_cents
      FROM purchase_order WHERE purchase_order.tenant_id = ?
      ORDER BY purchase_order.status = 'draft' DESC, purchase_order.folio DESC
    `);
    this.#nextFolio = store.prepare('SELECT coalesce(max(folio), 0) + 1 AS folio FROM purchase_order WHERE tenant_id = ?');
    this.#insertOrder = store.prepare(`
      INSERT INTO purchase_order (id, tenant_id, folio, supplier_id, supplier_name, status, notes, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
    `);
    this.#updateDraft = store.prepare(`
      UPDATE purchase_order SET supplier_id = ?, supplier_name = ?, notes = ?, updated_at = ?, revision = revision + 1
      WHERE tenant_id = ? AND id = ? AND revision = ? AND status = 'draft'
    `);
    this.#deleteLines = store.prepare('DELETE FROM purchase_order_line WHERE tenant_id = ? AND order_id = ?');
    this.#insertLine = store.prepare(`
      INSERT INTO purchase_order_line
        (id, tenant_id, order_id, line_number, product_id, description, supplier_code, barcode, unit, quantity_milli, unit_cost_e6, line_total_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.#markSent = store.prepare(`
      UPDATE purchase_order SET status = 'sent', sent_by = ?, sent_at = ?, updated_at = ?, revision = revision + 1
      WHERE tenant_id = ? AND id = ? AND revision = ? AND status = 'draft'
    `);
    this.#deleteDraft = store.prepare("DELETE FROM purchase_order WHERE tenant_id = ? AND id = ? AND revision = ? AND status = 'draft'");
    this.#codesOf = store.prepare(`
      SELECT supplier_code, list_cost_e6, purchase_unit FROM supplier_product_code
      WHERE tenant_id = ? AND supplier_id = ? AND product_id = ? ORDER BY supplier_code
    `);
    this.#productsByCode = store.prepare(`
      SELECT DISTINCT product.id AS product_id, supplier_product_code.supplier_code AS supplier_code
      FROM supplier_product_code JOIN product ON product.id = supplier_product_code.product_id
      WHERE supplier_product_code.tenant_id = ? AND supplier_product_code.supplier_id = ? AND supplier_product_code.supplier_code = ?
        AND product.is_active = 1
      ORDER BY product.name
    `);
    this.#levelOf = store.prepare('SELECT minimum_milli, maximum_milli FROM product_reorder_level WHERE tenant_id = ? AND product_id = ?');
    this.#lowProducts = store.prepare(`
      SELECT level.product_id
      FROM product_reorder_level AS level JOIN product ON product.id = level.product_id AND product.is_active = 1
      WHERE level.tenant_id = ?
        AND (SELECT coalesce(sum(quantity_milli), 0) FROM stock_movement WHERE tenant_id = level.tenant_id AND product_id = level.product_id) <= level.minimum_milli
      ORDER BY product.name COLLATE NOCASE
      LIMIT ${SUGGESTION_LIMIT}
    `);
    this.#supplierHasLinks = store.prepare('SELECT 1 AS found FROM supplier_product_code WHERE tenant_id = ? AND supplier_id = ? LIMIT 1');
    this.#productHasCodeOf = store.prepare('SELECT 1 AS found FROM supplier_product_code WHERE tenant_id = ? AND supplier_id = ? AND product_id = ? LIMIT 1');
    this.#upsertLevel = store.prepare(`
      INSERT INTO product_reorder_level (tenant_id, product_id, minimum_milli, maximum_milli, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, product_id) DO UPDATE SET minimum_milli = excluded.minimum_milli, maximum_milli = excluded.maximum_milli, updated_at = excluded.updated_at
    `);
  }

  /**
   * Finds the products to put on an order, by what the person typed or the scanner read. A barcode or a code of the supplier
   * answers exactly; otherwise the words are looked for in the names. A code that several products share lists them all.
   *
   * @param request the supplier of the order, and the text
   * @returns the products that are sold, the best matches first, at most 20
   */
  search({ supplierId, text }: SearchOrderProductsRequest): OrderCandidate[] {
    const typed = text.trim();
    if (typed === '') {
      return [];
    }
    const found = new Map<string, OrderCandidate['matchedBy']>();
    const byBarcode = this.#catalog.findByCode(typed);
    if (byBarcode !== null) {
      found.set(byBarcode.id, 'barcode');
    }
    if (supplierId !== null) {
      for (const row of this.#productsByCode.all(this.#tenantId, supplierId, typed) as unknown as { product_id: string }[]) {
        if (!found.has(row.product_id)) {
          found.set(row.product_id, 'supplier_code');
        }
      }
    }
    if (found.size === 0) {
      for (const product of this.#catalog.search(typed, SEARCH_LIMIT)) {
        found.set(product.id, 'name');
      }
    }
    const candidates: OrderCandidate[] = [];
    for (const [productId, matchedBy] of found) {
      const candidate = this.#candidate(productId, supplierId, matchedBy, supplierId === null || matchedBy !== 'supplier_code' ? null : typed);
      if (candidate !== null) {
        candidates.push(candidate);
      }
    }
    return candidates.slice(0, SEARCH_LIMIT);
  }

  /**
   * Lists the products that are at or below their minimum, with what to order to fill them. It only looks at products that
   * have a reorder level, and, when the supplier has codes for some products, only at the products it sells.
   *
   * @param supplierId the supplier of the order
   * @returns the low products by name, with `suggestedMilli` filled
   */
  suggest(supplierId: string): OrderCandidate[] {
    const restrict = this.#supplierHasLinks.get(this.#tenantId, supplierId) !== undefined;
    const candidates: OrderCandidate[] = [];
    for (const row of this.#lowProducts.all(this.#tenantId) as unknown as { product_id: string }[]) {
      if (restrict && this.#productHasCodeOf.get(this.#tenantId, supplierId, row.product_id) === undefined) {
        continue;
      }
      const candidate = this.#candidate(row.product_id, supplierId, 'low_stock', null);
      if (candidate !== null && candidate.suggestedMilli !== null) {
        candidates.push(candidate);
      }
    }
    return candidates;
  }

  /**
   * Sets when a product counts as low and how far to fill it. It is kept in the register until the core takes it over
   * (F2-16), so it is audited but not sent.
   *
   * @param request the product, the levels and the PIN of an owner when a cashier asks
   * @returns `saved` with the product as the order screen shows it, or why nothing was written
   * @throws Error if nobody is signed in
   * @throws RangeError if a level is not a whole quantity of the unit of the product, the minimum is not above zero, or the
   *   maximum is not above the minimum
   */
  setReorderLevel(request: SetReorderLevelRequest): SetReorderLevelResult {
    const user = this.#auth.currentUser();
    if (user === null) {
      throw new Error('Setting a reorder level needs a person signed in');
    }
    const product = this.#reader.detail(request.productId);
    if (product === null) {
      return { status: 'product_not_found' };
    }
    assertLevel(request.minimumMilli, product.unit, 'minimum');
    if (request.maximumMilli !== null) {
      assertLevel(request.maximumMilli, product.unit, 'maximum');
      if (request.maximumMilli <= request.minimumMilli) {
        throw new RangeError('The maximum must be above the minimum');
      }
    }
    const approval = this.#gate.authorize({
      user,
      ownerPin: request.ownerPin,
      deniedAction: 'reorder_level.set_denied',
      entity: 'product',
      entityId: product.id,
      deniedDetail: `tried to set the minimum of ${product.name} to ${request.minimumMilli} thousandths`,
    });
    if (isRefusal(approval)) {
      return approval;
    }
    const previous = this.#levelOf.get(this.#tenantId, product.id) as unknown as LevelRow | undefined;
    this.#store.transaction(() => {
      this.#upsertLevel.run(this.#tenantId, product.id, request.minimumMilli, request.maximumMilli, new Date().toISOString());
      this.#audit.record({
        userId: user.id,
        action: 'reorder_level.set',
        entity: 'product',
        entityId: product.id,
        detail: `${product.name}: minimum ${previous?.minimum_milli ?? 'none'} -> ${request.minimumMilli}, maximum ${previous?.maximum_milli ?? 'none'} -> ${request.maximumMilli ?? 'none'} thousandths; approved by ${approval.ownerId}`,
      });
    });
    return { status: 'saved', candidate: this.#candidate(product.id, null, 'name', null)! };
  }

  /**
   * Lists the orders, the drafts first and then the sent ones, newest first.
   *
   * @returns the orders with their number of lines and their total
   */
  list(): PurchaseOrderSummary[] {
    const rows = this.#summaries.all(this.#tenantId) as unknown as SummaryRow[];
    return rows.map((row) => ({
      id: row.id,
      folio: row.folio,
      supplierName: row.supplier_name,
      status: row.status,
      updatedAt: row.updated_at,
      lineCount: row.line_count,
      totalCents: row.total_cents,
    }));
  }

  /**
   * Reads an order with its lines.
   *
   * @param orderId the UUIDv7 of the order
   * @returns the order, or null if the business has none with that id
   */
  get(orderId: string): PurchaseOrder | null {
    const row = this.#orderById.get(this.#tenantId, orderId) as unknown as OrderRow | undefined;
    if (row === undefined) {
      return null;
    }
    const lines = (this.#linesOf.all(this.#tenantId, orderId) as unknown as LineRow[]).map(
      (line): OrderLine => ({
        lineNumber: line.line_number,
        productId: line.product_id,
        description: line.description,
        supplierCode: line.supplier_code,
        barcode: line.barcode,
        unit: line.unit,
        quantityMilli: line.quantity_milli,
        unitCostE6: line.unit_cost_e6,
        lineTotalCents: line.line_total_cents,
      }),
    );
    return {
      id: row.id,
      folio: row.folio,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      status: row.status,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      sentAt: row.sent_at,
      revision: row.revision,
      lines,
      totalCents: lines.reduce((total, line) => total + (line.lineTotalCents ?? 0), 0),
      linesWithoutCost: lines.filter((line) => line.lineTotalCents === null).length,
    };
  }

  /**
   * Saves an order as a draft, new or changed, replacing its lines. A sent order, or a draft that changed after the screen
   * loaded it, is never overwritten.
   *
   * @param request the supplier, the notes and the lines, with the revision the screen saw when it is a change
   * @returns `saved` with the order, or why nothing was written
   * @throws Error if nobody is signed in
   * @throws RangeError if there are too many lines, a quantity is not a whole quantity of the unit of its product or is
   *   above the limit, a cost is out of range, or a text is too long
   */
  save(request: SaveOrderRequest): SaveOrderResult {
    const user = this.#auth.currentUser();
    if (user === null) {
      throw new Error('Saving an order needs a person signed in');
    }
    if (request.lines.length > MAX_ORDER_LINES) {
      throw new RangeError(`An order has at most ${MAX_ORDER_LINES} lines`);
    }
    const notes = optionalText(request.notes, MAX_NOTES_LENGTH, 'notes');
    const current = request.orderId === undefined ? null : this.get(request.orderId);
    if (request.orderId !== undefined) {
      if (current === null) {
        return { status: 'not_found' };
      }
      if (current.status !== 'draft' || current.revision !== request.expectedRevision) {
        return { status: 'stale', order: current };
      }
    }
    const supplier = this.#suppliers.find(request.supplierId);
    // A draft keeps its supplier even if it was given up meanwhile, but a given up supplier is not chosen for an order.
    if (supplier === null || (!supplier.isActive && current?.supplierId !== supplier.id)) {
      return { status: 'supplier_not_found' };
    }
    const lines: PreparedLine[] = [];
    for (const line of request.lines) {
      const prepared = this.#prepareLine(line);
      if (prepared === null) {
        return { status: 'product_not_found', productId: line.productId };
      }
      lines.push(prepared);
    }

    const approval = this.#gate.authorize({
      user,
      ownerPin: request.ownerPin,
      deniedAction: 'purchase_order.save_denied',
      entity: 'purchase_order',
      entityId: current?.id ?? 'new',
      deniedDetail: `tried to save an order for ${supplier.name} with ${lines.length} lines`,
    });
    if (isRefusal(approval)) {
      return approval;
    }

    const orderId = current?.id ?? uuidV7();
    const now = new Date().toISOString();
    this.#store.transaction(() => {
      let folio: number;
      if (current === null) {
        folio = (this.#nextFolio.get(this.#tenantId) as unknown as { folio: number }).folio;
        this.#insertOrder.run(orderId, this.#tenantId, folio, supplier.id, supplier.name, notes, user.id, now, now);
      } else {
        folio = current.folio;
        const written = this.#updateDraft.run(supplier.id, supplier.name, notes, now, this.#tenantId, orderId, current.revision);
        if (Number(written.changes) !== 1) {
          throw new Error('The order changed while it was being saved');
        }
        this.#deleteLines.run(this.#tenantId, orderId);
      }
      lines.forEach((line, index) => {
        this.#insertLine.run(
          uuidV7(),
          this.#tenantId,
          orderId,
          index + 1,
          line.productId,
          line.description,
          line.supplierCode,
          line.barcode,
          line.unit,
          line.quantityMilli,
          line.unitCostE6,
          line.lineTotalCents,
        );
      });
      this.#audit.record({
        userId: user.id,
        action: current === null ? 'purchase_order.create' : 'purchase_order.update',
        entity: 'purchase_order',
        entityId: orderId,
        detail: `${formatFolio(folio)} for ${supplier.name}: ${lines.length} lines; approved by ${approval.ownerId}`,
      });
    });
    return { status: 'saved', order: this.get(orderId)! };
  }

  /**
   * Marks a draft as sent. From then on the order never changes. The operation for the core is queued in the same
   * transaction, so the server hears about every order the owner sent.
   *
   * @param request the order, the revision the screen saw and the PIN of an owner when a cashier asks
   * @returns `sent` with the order, or why nothing was written
   * @throws Error if nobody is signed in
   */
  markSent(request: OrderActionRequest): MarkOrderSentResult {
    const user = this.#auth.currentUser();
    if (user === null) {
      throw new Error('Sending an order needs a person signed in');
    }
    const current = this.get(request.orderId);
    if (current === null) {
      return { status: 'not_found' };
    }
    if (current.status === 'sent') {
      return { status: 'already_sent', order: current };
    }
    if (current.revision !== request.expectedRevision) {
      return { status: 'stale', order: current };
    }
    if (current.lines.length === 0) {
      return { status: 'empty' };
    }
    const approval = this.#gate.authorize({
      user,
      ownerPin: request.ownerPin,
      deniedAction: 'purchase_order.send_denied',
      entity: 'purchase_order',
      entityId: current.id,
      deniedDetail: `tried to send ${formatFolio(current.folio)} to ${current.supplierName}`,
    });
    if (isRefusal(approval)) {
      return approval;
    }

    const sentAt = new Date().toISOString();
    this.#store.transaction(() => {
      const written = this.#markSent.run(user.id, sentAt, sentAt, this.#tenantId, current.id, current.revision);
      if (Number(written.changes) !== 1) {
        throw new Error('The order changed while it was being sent');
      }
      this.#audit.record({
        userId: user.id,
        action: 'purchase_order.send',
        entity: 'purchase_order',
        entityId: current.id,
        detail: `${formatFolio(current.folio)} to ${current.supplierName}: ${current.lines.length} lines, ${current.totalCents} cents estimated; approved by ${approval.ownerId}`,
      });
      this.#outbox.enqueue(
        'purchase_order.sent',
        {
          orderId: current.id,
          folio: current.folio,
          supplierId: current.supplierId,
          supplierName: current.supplierName,
          notes: current.notes,
          lines: current.lines.map((line) => ({
            lineNumber: line.lineNumber,
            productId: line.productId,
            description: line.description,
            supplierCode: line.supplierCode,
            barcode: line.barcode,
            unit: line.unit,
            quantityMilli: line.quantityMilli,
            unitCostE6: line.unitCostE6,
            lineTotalCents: line.lineTotalCents,
          })),
          totalCents: current.totalCents,
          sentBy: user.id,
          authorizedBy: approval.ownerId,
        },
        sentAt,
      );
    });
    return { status: 'sent', order: this.get(current.id)! };
  }

  /**
   * Throws a draft away. A sent order is never discarded: it stays as the history of what was asked.
   *
   * @param request the order, the revision the screen saw and the PIN of an owner when a cashier asks
   * @returns `discarded`, or why nothing was deleted
   * @throws Error if nobody is signed in
   */
  discard(request: OrderActionRequest): DiscardOrderResult {
    const user = this.#auth.currentUser();
    if (user === null) {
      throw new Error('Discarding an order needs a person signed in');
    }
    const current = this.get(request.orderId);
    if (current === null) {
      return { status: 'not_found' };
    }
    if (current.status === 'sent') {
      return { status: 'already_sent', order: current };
    }
    if (current.revision !== request.expectedRevision) {
      return { status: 'stale', order: current };
    }
    const approval = this.#gate.authorize({
      user,
      ownerPin: request.ownerPin,
      deniedAction: 'purchase_order.discard_denied',
      entity: 'purchase_order',
      entityId: current.id,
      deniedDetail: `tried to discard the draft ${formatFolio(current.folio)}`,
    });
    if (isRefusal(approval)) {
      return approval;
    }
    this.#store.transaction(() => {
      const written = this.#deleteDraft.run(this.#tenantId, current.id, current.revision);
      if (Number(written.changes) !== 1) {
        throw new Error('The order changed while it was being discarded');
      }
      this.#audit.record({
        userId: user.id,
        action: 'purchase_order.discard',
        entity: 'purchase_order',
        entityId: current.id,
        detail: `Draft ${formatFolio(current.folio)} for ${current.supplierName}, ${current.lines.length} lines; approved by ${approval.ownerId}`,
      });
    });
    return { status: 'discarded' };
  }

  #prepareLine(line: OrderLineRequest): PreparedLine | null {
    const product = this.#reader.detail(line.productId);
    if (product === null) {
      return null;
    }
    if (!Number.isSafeInteger(line.quantityMilli) || line.quantityMilli <= 0 || line.quantityMilli > MAX_ORDER_QUANTITY_MILLI) {
      throw new RangeError(`The quantity of ${product.name} must be a whole number of thousandths above zero and up to ${MAX_ORDER_QUANTITY_MILLI}`);
    }
    // Throws if the quantity is a fraction of a piece.
    quantityOf(line.quantityMilli, product.unit);
    if (line.unitCostE6 !== null && (!Number.isSafeInteger(line.unitCostE6) || line.unitCostE6 < 0 || line.unitCostE6 > MAX_ORDER_UNIT_COST_E6)) {
      throw new RangeError(`The cost must be null or a whole number of millionths from 0 up to ${MAX_ORDER_UNIT_COST_E6}`);
    }
    const supplierCode = optionalText(line.supplierCode, MAX_SUPPLIER_CODE_LENGTH, 'code of the supplier');
    return {
      productId: product.id,
      description: product.name,
      supplierCode,
      barcode: product.barcodes[0] ?? null,
      unit: product.unit,
      quantityMilli: line.quantityMilli,
      unitCostE6: line.unitCostE6,
      lineTotalCents: line.unitCostE6 === null ? null : orderLineCents(line.unitCostE6, line.quantityMilli),
    };
  }

  /** Builds what the screen needs about a product. `searchedCode` puts the code that was typed first. */
  #candidate(productId: string, supplierId: string | null, matchedBy: OrderCandidate['matchedBy'], searchedCode: string | null): OrderCandidate | null {
    const product = this.#reader.detail(productId);
    if (product === null) {
      return null;
    }
    const codes: SupplierCode[] =
      supplierId === null
        ? []
        : (this.#codesOf.all(this.#tenantId, supplierId, productId) as unknown as CodeRow[])
            .map((row) => ({ supplierCode: row.supplier_code, listCostE6: row.list_cost_e6, purchaseUnit: row.purchase_unit }))
            .sort((left, right) => Number(right.supplierCode.toLowerCase() === searchedCode?.toLowerCase()) - Number(left.supplierCode.toLowerCase() === searchedCode?.toLowerCase()));
    const level = this.#levelOf.get(this.#tenantId, productId) as unknown as LevelRow | undefined;
    const minimumMilli = level?.minimum_milli ?? null;
    const maximumMilli = level?.maximum_milli ?? null;
    return {
      productId,
      name: product.name,
      unit: product.unit,
      barcode: product.barcodes[0] ?? null,
      stockMilli: product.stockMilli,
      estimatedCostE6: codes.find((code) => code.listCostE6 !== null)?.listCostE6 ?? product.effectiveCostE6,
      supplierCodes: codes,
      minimumMilli,
      maximumMilli,
      suggestedMilli: suggestedQuantity(product.stockMilli, minimumMilli, maximumMilli),
      matchedBy,
    };
  }
}

/** Checks a reorder level: a whole quantity of the unit, above zero, within the limit. */
function assertLevel(milli: number, unit: Unit, description: string): void {
  if (!Number.isSafeInteger(milli) || milli <= 0 || milli > MAX_REORDER_LEVEL_MILLI) {
    throw new RangeError(`The ${description} must be a whole number of thousandths above zero and up to ${MAX_REORDER_LEVEL_MILLI}`);
  }
  // Throws if the level is a fraction of a piece.
  quantityOf(milli, unit);
}
