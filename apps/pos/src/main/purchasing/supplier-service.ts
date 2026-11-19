import type { StatementSync } from 'node:sqlite';

import {
  MAX_CODES_PER_SUPPLIER_PRODUCT,
  MAX_NOTES_LENGTH,
  MAX_ORDER_UNIT_COST_E6,
  MAX_PURCHASE_UNIT_LENGTH,
  MAX_SUPPLIER_CODE_LENGTH,
  MAX_SUPPLIER_CONTACT_LENGTH,
  MAX_SUPPLIER_NAME_LENGTH,
  formatFolio,
  type ChangeSupplierLinkRequest,
  type ChangeSupplierLinkResult,
  type DraftOrderRef,
  type SaveSupplierRequest,
  type SaveSupplierResult,
  type SetSupplierCodesRequest,
  type SetSupplierCodesResult,
  type Supplier,
  type SupplierCode,
  type SupplierProductLink,
  type SupplierProductRef,
  type UnlinkSupplierRequest,
  type UnlinkSupplierResult,
} from '../../shared/supplier-order';
import type { AuditLog } from '../audit/audit-log';
import type { AuthService } from '../auth/auth-service';
import { isRefusal, OwnerGate } from '../auth/owner-gate';
import type { LocalStore } from '../local-store/local-store';
import { SyncOutbox } from '../sync/sync-outbox';
import { uuidV7 } from '../uuid-v7';

interface SupplierRow {
  readonly id: string;
  readonly name: string;
  readonly contact: string | null;
  readonly notes: string | null;
  readonly is_active: number;
  readonly revision: number;
}

interface LinkRow {
  readonly supplier_id: string;
  readonly supplier_name: string;
  readonly supplier_code: string;
  readonly list_cost_e6: number | null;
  readonly purchase_unit: string | null;
}

/** A character that cannot be part of a code or a name that is typed or scanned: a control character. */
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

/**
 * Trims a text that may be left empty.
 *
 * @param value what was typed, or null
 * @param limit the most characters it can have
 * @param description what the text is, for the error
 * @returns the text, or null when it is empty
 * @throws RangeError if it is longer than the limit
 */
export function optionalText(value: string | null, limit: number, description: string): string | null {
  const text = value?.trim() ?? '';
  if ([...text].length > limit) {
    throw new RangeError(`The ${description} can have at most ${limit} characters`);
  }
  return text === '' ? null : text;
}

function toSupplier(row: SupplierRow): Supplier {
  return { id: row.id, name: row.name, contact: row.contact, notes: row.notes, isActive: row.is_active === 1, revision: row.revision };
}

/**
 * The suppliers of the business and the codes they give to the products (E1-44, ADR 0059). A supplier is given up, never
 * deleted. Everything that writes needs the owner, or the PIN of an owner for a cashier (ADR 0047), and is written in one
 * transaction with its audit entry and its operation for the core, so none of them can exist without the others.
 */
export class SupplierService {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  readonly #auth: Pick<AuthService, 'currentUser' | 'authorizeWithOwnerPin'>;
  readonly #audit: Pick<AuditLog, 'record'>;
  readonly #gate: OwnerGate;
  readonly #outbox: SyncOutbox;
  readonly #listAll: StatementSync;
  readonly #listActive: StatementSync;
  readonly #byId: StatementSync;
  readonly #byName: StatementSync;
  readonly #insert: StatementSync;
  readonly #update: StatementSync;
  readonly #linksOfProduct: StatementSync;
  readonly #linksOfSupplierProduct: StatementSync;
  readonly #deleteLinks: StatementSync;
  readonly #insertLink: StatementSync;
  readonly #productExists: StatementSync;
  readonly #draftsWithProduct: StatementSync;
  readonly #deleteDraftLinesOf: StatementSync;
  readonly #draftLineIds: StatementSync;
  readonly #renumberLine: StatementSync;
  readonly #touchDraft: StatementSync;

  /**
   * @param store the open local database
   * @param tenantId the business
   * @param auth who is signed in, and who can approve with a PIN
   * @param audit the audit log
   */
  constructor(
    store: LocalStore,
    tenantId: string,
    auth: Pick<AuthService, 'currentUser' | 'authorizeWithOwnerPin'>,
    audit: Pick<AuditLog, 'record'>,
  ) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#auth = auth;
    this.#audit = audit;
    this.#gate = new OwnerGate(auth, audit);
    this.#outbox = new SyncOutbox(store, tenantId);
    const columns = 'id, name, contact, notes, is_active, revision';
    this.#listAll = store.prepare(`SELECT ${columns} FROM supplier WHERE tenant_id = ? ORDER BY name COLLATE NOCASE`);
    this.#listActive = store.prepare(`SELECT ${columns} FROM supplier WHERE tenant_id = ? AND is_active = 1 ORDER BY name COLLATE NOCASE`);
    this.#byId = store.prepare(`SELECT ${columns} FROM supplier WHERE tenant_id = ? AND id = ?`);
    this.#byName = store.prepare(`SELECT ${columns} FROM supplier WHERE tenant_id = ? AND name = ? COLLATE NOCASE`);
    this.#insert = store.prepare(`
      INSERT INTO supplier (id, tenant_id, name, contact, notes, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.#update = store.prepare(`
      UPDATE supplier SET name = ?, contact = ?, notes = ?, is_active = ?, updated_at = ?, revision = revision + 1
      WHERE tenant_id = ? AND id = ? AND revision = ?
    `);
    this.#linksOfProduct = store.prepare(`
      SELECT supplier.id AS supplier_id, supplier.name AS supplier_name, code.supplier_code, code.list_cost_e6, code.purchase_unit
      FROM supplier_product_code AS code JOIN supplier ON supplier.id = code.supplier_id
      WHERE code.tenant_id = ? AND code.product_id = ?
      ORDER BY supplier.name COLLATE NOCASE, code.supplier_code
    `);
    this.#linksOfSupplierProduct = store.prepare(`
      SELECT supplier_id, '' AS supplier_name, supplier_code, list_cost_e6, purchase_unit FROM supplier_product_code
      WHERE tenant_id = ? AND supplier_id = ? AND product_id = ? ORDER BY supplier_code
    `);
    this.#deleteLinks = store.prepare('DELETE FROM supplier_product_code WHERE tenant_id = ? AND supplier_id = ? AND product_id = ?');
    this.#insertLink = store.prepare(`
      INSERT INTO supplier_product_code (tenant_id, supplier_id, product_id, supplier_code, list_cost_e6, purchase_unit) VALUES (?, ?, ?, ?, ?, ?)
    `);
    this.#productExists = store.prepare('SELECT 1 AS found FROM product WHERE tenant_id = ? AND id = ?');
    this.#draftsWithProduct = store.prepare(`
      SELECT DISTINCT purchase_order.id AS order_id, purchase_order.folio
      FROM purchase_order JOIN purchase_order_line AS line ON line.order_id = purchase_order.id
      WHERE purchase_order.tenant_id = ? AND purchase_order.supplier_id = ? AND purchase_order.status = 'draft' AND line.product_id = ?
      ORDER BY purchase_order.folio
    `);
    this.#deleteDraftLinesOf = store.prepare('DELETE FROM purchase_order_line WHERE tenant_id = ? AND order_id = ? AND product_id = ?');
    this.#draftLineIds = store.prepare('SELECT id FROM purchase_order_line WHERE tenant_id = ? AND order_id = ? ORDER BY line_number');
    this.#renumberLine = store.prepare('UPDATE purchase_order_line SET line_number = ? WHERE tenant_id = ? AND id = ?');
    this.#touchDraft = store.prepare(`
      UPDATE purchase_order SET updated_at = ?, revision = revision + 1 WHERE tenant_id = ? AND id = ? AND status = 'draft'
    `);
  }

  /**
   * Lists the suppliers by name.
   *
   * @param includeInactive whether the ones that were given up are listed too
   * @returns the suppliers
   */
  list(includeInactive: boolean): Supplier[] {
    const rows = (includeInactive ? this.#listAll : this.#listActive).all(this.#tenantId) as unknown as SupplierRow[];
    return rows.map(toSupplier);
  }

  /**
   * Reads one supplier, active or not.
   *
   * @param supplierId the UUIDv7 of the supplier
   * @returns the supplier, or null if the business has none with that id
   */
  find(supplierId: string): Supplier | null {
    const row = this.#byId.get(this.#tenantId, supplierId) as unknown as SupplierRow | undefined;
    return row === undefined ? null : toSupplier(row);
  }

  /**
   * Adds a supplier or changes one. A change needs the revision the screen saw, so a supplier that changed meanwhile is
   * never overwritten with an old copy.
   *
   * @param request what the form collected, with the PIN of an owner when a cashier asks
   * @returns `saved` with the supplier, or why nothing was written. A name another supplier has, a stale revision and the
   *   refusals of the approval are answers, and the refusals are written in the audit log.
   * @throws Error if nobody is signed in
   * @throws RangeError if a text is too long or the name is empty
   */
  save(request: SaveSupplierRequest): SaveSupplierResult {
    const user = this.#auth.currentUser();
    if (user === null) {
      throw new Error('Saving a supplier needs a person signed in');
    }
    const name = request.name.trim();
    if (name === '' || [...name].length > MAX_SUPPLIER_NAME_LENGTH) {
      throw new RangeError(`The name of the supplier needs from 1 to ${MAX_SUPPLIER_NAME_LENGTH} characters`);
    }
    const contact = optionalText(request.contact, MAX_SUPPLIER_CONTACT_LENGTH, 'contact');
    const notes = optionalText(request.notes, MAX_NOTES_LENGTH, 'notes');

    const sameName = this.#byName.get(this.#tenantId, name) as unknown as SupplierRow | undefined;
    const current = request.supplierId === undefined ? undefined : this.#readRow(request.supplierId);
    if (request.supplierId !== undefined) {
      if (current === undefined) {
        return { status: 'not_found' };
      }
      if (current.revision !== request.expectedRevision) {
        return { status: 'stale', supplier: toSupplier(current) };
      }
      if (current.name === name && current.contact === contact && current.notes === notes && (current.is_active === 1) === request.isActive) {
        return { status: 'unchanged', supplier: toSupplier(current) };
      }
    }
    if (sameName !== undefined && sameName.id !== request.supplierId) {
      return { status: 'duplicate_name', supplierId: sameName.id, name: sameName.name };
    }

    const approval = this.#gate.authorize({
      user,
      ownerPin: request.ownerPin,
      deniedAction: 'supplier.save_denied',
      entity: 'supplier',
      entityId: request.supplierId ?? 'new',
      deniedDetail: `tried to ${request.supplierId === undefined ? 'add' : 'change'} the supplier ${name}`,
    });
    if (isRefusal(approval)) {
      return approval;
    }

    const supplierId = request.supplierId ?? uuidV7();
    const now = new Date().toISOString();
    this.#store.transaction(() => {
      let revision = 1;
      if (current === undefined) {
        this.#insert.run(supplierId, this.#tenantId, name, contact, notes, request.isActive ? 1 : 0, now, now);
      } else {
        const written = this.#update.run(name, contact, notes, request.isActive ? 1 : 0, now, this.#tenantId, supplierId, current.revision);
        if (Number(written.changes) !== 1) {
          throw new Error('The supplier changed while it was being saved');
        }
        revision = current.revision + 1;
      }
      this.#audit.record({
        userId: user.id,
        action: current === undefined ? 'supplier.create' : 'supplier.update',
        entity: 'supplier',
        entityId: supplierId,
        detail: `${name}: ${request.isActive ? 'active' : 'inactive'}${contact === null ? '' : `, contact ${contact}`}; approved by ${approval.ownerId}`,
      });
      this.#outbox.enqueue(
        'supplier.upserted',
        { supplierId, name, contact, notes, isActive: request.isActive, revision, savedBy: user.id, authorizedBy: approval.ownerId },
        now,
      );
    });
    return { status: 'saved', supplier: this.find(supplierId)! };
  }

  /**
   * Reads the codes that every supplier gives to a product.
   *
   * @param productId the UUIDv7 of the product
   * @returns one entry per supplier that has codes for it, by supplier name
   */
  linksOfProduct(productId: string): SupplierProductLink[] {
    const rows = this.#linksOfProduct.all(this.#tenantId, productId) as unknown as LinkRow[];
    return groupLinks(rows, productId);
  }

  /**
   * Sets all the codes one supplier gives to one product, replacing what was there. An empty list removes them. Several
   * products may share a code of the same supplier (a supplier that sells one code for a pack), and the same product may
   * have several codes.
   *
   * @param request the supplier, the product, the codes, and the PIN of an owner when a cashier asks
   * @returns `saved` with the codes of the product for every supplier, `unchanged` if they already were these, or why
   *   nothing was written
   * @throws Error if nobody is signed in
   * @throws RangeError if a code is empty, too long, has a control character or repeats another one of the list, or a cost
   *   or a presentation is out of range
   */
  setCodes(request: SetSupplierCodesRequest): SetSupplierCodesResult {
    const user = this.#auth.currentUser();
    if (user === null) {
      throw new Error('Saving supplier codes needs a person signed in');
    }
    const codes = normalizeCodes(request.codes);
    const supplier = this.find(request.supplierId);
    if (supplier === null) {
      return { status: 'supplier_not_found' };
    }
    if (this.#productExists.get(this.#tenantId, request.productId) === undefined) {
      return { status: 'product_not_found' };
    }
    const previous = toCodes(this.#linksOfSupplierProduct.all(this.#tenantId, request.supplierId, request.productId) as unknown as LinkRow[]);
    if (sameCodes(previous, codes)) {
      return { status: 'unchanged', links: this.linksOfProduct(request.productId) };
    }
    const approval = this.#gate.authorize({
      user,
      ownerPin: request.ownerPin,
      deniedAction: 'supplier_codes.set_denied',
      entity: 'product',
      entityId: request.productId,
      deniedDetail: `tried to set the codes of ${supplier.name}`,
    });
    if (isRefusal(approval)) {
      return approval;
    }

    const now = new Date().toISOString();
    this.#store.transaction(() => {
      this.#deleteLinks.run(this.#tenantId, request.supplierId, request.productId);
      for (const code of codes) {
        this.#insertLink.run(this.#tenantId, request.supplierId, request.productId, code.supplierCode, code.listCostE6, code.purchaseUnit);
      }
      this.#audit.record({
        userId: user.id,
        action: 'supplier_codes.set',
        entity: 'product',
        entityId: request.productId,
        detail: `${supplier.name}: [${previous.map((code) => code.supplierCode).join(', ')}] -> [${codes.map((code) => code.supplierCode).join(', ')}]; approved by ${approval.ownerId}`,
      });
      this.#outbox.enqueue(
        'supplier_product.upserted',
        { supplierId: request.supplierId, productId: request.productId, codes, savedBy: user.id, authorizedBy: approval.ownerId },
        now,
      );
    });
    return { status: 'saved', links: this.linksOfProduct(request.productId) };
  }

  /**
   * Changes one supplier row of a product (E1-58, ADR 0074): to another supplier, other codes or another list cost. When the
   * supplier changes, the old one loses its codes and the new one gets them in the same transaction, so the product never
   * has both or neither. Orders are never touched: each line keeps the copy it took when it was written.
   *
   * @param request the product, the supplier it has, the one it will have, the codes, and the PIN of an owner for a cashier
   * @returns `saved` with the codes of the product for every supplier, `unchanged` if nothing differs, or why nothing was
   *   written: the old supplier no longer has it, the new one already has it, is unknown or was given up, or no approval
   * @throws Error if nobody is signed in
   * @throws RangeError if the list of codes is empty, or a code or a cost is wrong (the same rules as {@link setCodes})
   */
  changeLink(request: ChangeSupplierLinkRequest): ChangeSupplierLinkResult {
    const user = this.#auth.currentUser();
    if (user === null) {
      throw new Error('Changing a supplier of a product needs a person signed in');
    }
    const codes = normalizeCodes(request.codes);
    if (codes.length === 0) {
      throw new RangeError('A supplier of a product needs at least one code; removing them all is unlinking it');
    }
    if (this.#productExists.get(this.#tenantId, request.productId) === undefined) {
      return { status: 'product_not_found' };
    }
    const previous = this.#codesOf(request.fromSupplierId, request.productId);
    if (previous.length === 0) {
      return { status: 'not_linked', links: this.linksOfProduct(request.productId) };
    }
    const moves = request.toSupplierId !== request.fromSupplierId;
    const target = this.find(request.toSupplierId);
    if (target === null || (moves && !target.isActive)) {
      return { status: 'supplier_not_found' };
    }
    if (moves && this.#codesOf(target.id, request.productId).length > 0) {
      return { status: 'already_linked', supplierName: target.name };
    }
    if (!moves && sameCodes(previous, codes)) {
      return { status: 'unchanged', links: this.linksOfProduct(request.productId) };
    }
    const source = this.find(request.fromSupplierId)!;
    const approval = this.#gate.authorize({
      user,
      ownerPin: request.ownerPin,
      deniedAction: 'supplier_codes.change_denied',
      entity: 'product',
      entityId: request.productId,
      deniedDetail: moves ? `tried to move the codes from ${source.name} to ${target.name}` : `tried to change the codes of ${source.name}`,
    });
    if (isRefusal(approval)) {
      return approval;
    }

    const now = new Date().toISOString();
    this.#store.transaction(() => {
      this.#deleteLinks.run(this.#tenantId, source.id, request.productId);
      for (const code of codes) {
        this.#insertLink.run(this.#tenantId, target.id, request.productId, code.supplierCode, code.listCostE6, code.purchaseUnit);
      }
      this.#audit.record({
        userId: user.id,
        action: 'supplier_codes.change',
        entity: 'product',
        entityId: request.productId,
        detail: `${source.name} [${describeCodes(previous)}] -> ${target.name} [${describeCodes(codes)}]; approved by ${approval.ownerId}`,
      });
      const who = { savedBy: user.id, authorizedBy: approval.ownerId };
      if (moves) {
        this.#outbox.enqueue('supplier_product.upserted', { supplierId: source.id, productId: request.productId, codes: [], ...who }, now);
      }
      this.#outbox.enqueue('supplier_product.upserted', { supplierId: target.id, productId: request.productId, codes, ...who }, now);
    });
    return { status: 'saved', links: this.linksOfProduct(request.productId) };
  }

  /**
   * Finds the draft orders of a supplier that have a product, so the screen can tell the owner before removing that
   * supplier from the product. Sent orders are not listed: they never change.
   *
   * @param ref the supplier and the product
   * @returns the drafts, by folio
   */
  draftsWithProduct({ supplierId, productId }: SupplierProductRef): DraftOrderRef[] {
    const rows = this.#draftsWithProduct.all(this.#tenantId, supplierId, productId) as unknown as { order_id: string; folio: number }[];
    return rows.map((row) => ({ orderId: row.order_id, folio: row.folio }));
  }

  /**
   * Removes a supplier from a product (E1-58, ADR 0074): every code it gives to the product. A sent order keeps its copy and
   * is never touched. The product stays on the drafts of that supplier unless the person asks to take it off them, and then
   * the remaining lines are numbered again from 1 and each draft goes up one revision, so an open screen sees it changed.
   *
   * @param request the supplier, the product, whether to take it off the drafts, and the PIN of an owner for a cashier
   * @returns `removed` with the codes left and how many drafts changed, `not_linked` if the supplier no longer had it, or
   *   the refusal of the approval
   * @throws Error if nobody is signed in
   */
  unlink(request: UnlinkSupplierRequest): UnlinkSupplierResult {
    const user = this.#auth.currentUser();
    if (user === null) {
      throw new Error('Removing a supplier of a product needs a person signed in');
    }
    const previous = this.#codesOf(request.supplierId, request.productId);
    if (previous.length === 0) {
      return { status: 'not_linked', links: this.linksOfProduct(request.productId) };
    }
    const supplier = this.find(request.supplierId)!;
    const approval = this.#gate.authorize({
      user,
      ownerPin: request.ownerPin,
      deniedAction: 'supplier_codes.remove_denied',
      entity: 'product',
      entityId: request.productId,
      deniedDetail: `tried to remove ${supplier.name} from the product`,
    });
    if (isRefusal(approval)) {
      return approval;
    }

    const drafts = this.draftsWithProduct(request);
    const now = new Date().toISOString();
    this.#store.transaction(() => {
      this.#deleteLinks.run(this.#tenantId, supplier.id, request.productId);
      if (request.removeFromDrafts) {
        for (const draft of drafts) {
          this.#takeOffDraft(draft.orderId, request.productId, now);
        }
      }
      const folios = drafts.map((draft) => formatFolio(draft.folio)).join(', ');
      const draftNote = drafts.length === 0 ? 'in no draft' : `${request.removeFromDrafts ? 'taken off' : 'kept in'} ${folios}`;
      this.#audit.record({
        userId: user.id,
        action: 'supplier_codes.remove',
        entity: 'product',
        entityId: request.productId,
        detail: `${supplier.name} [${describeCodes(previous)}] removed, ${draftNote}; approved by ${approval.ownerId}`,
      });
      this.#outbox.enqueue(
        'supplier_product.upserted',
        { supplierId: supplier.id, productId: request.productId, codes: [], savedBy: user.id, authorizedBy: approval.ownerId },
        now,
      );
    });
    return { status: 'removed', links: this.linksOfProduct(request.productId), draftsChanged: request.removeFromDrafts ? drafts.length : 0 };
  }

  /** Takes a product off a draft, numbers the lines left from 1 without gaps, and moves the draft one revision up. */
  #takeOffDraft(orderId: string, productId: string, now: string): void {
    this.#deleteDraftLinesOf.run(this.#tenantId, orderId, productId);
    // Going up in order, each new number is free: it is the one that was removed or the one the previous line just left.
    const ids = this.#draftLineIds.all(this.#tenantId, orderId) as unknown as { id: string }[];
    ids.forEach(({ id }, index) => this.#renumberLine.run(index + 1, this.#tenantId, id));
    if (Number(this.#touchDraft.run(now, this.#tenantId, orderId).changes) !== 1) {
      throw new Error('The draft was sent while the supplier was being removed');
    }
  }

  #codesOf(supplierId: string, productId: string): SupplierCode[] {
    return toCodes(this.#linksOfSupplierProduct.all(this.#tenantId, supplierId, productId) as unknown as LinkRow[]);
  }

  #readRow(supplierId: string): SupplierRow | undefined {
    return this.#byId.get(this.#tenantId, supplierId) as unknown as SupplierRow | undefined;
  }
}

/** Checks the codes of a list and writes them the way they are stored. */
function normalizeCodes(codes: readonly SupplierCode[]): SupplierCode[] {
  if (codes.length > MAX_CODES_PER_SUPPLIER_PRODUCT) {
    throw new RangeError(`A product can have at most ${MAX_CODES_PER_SUPPLIER_PRODUCT} codes of one supplier`);
  }
  const seen = new Set<string>();
  return codes.map((entry) => {
    const supplierCode = entry.supplierCode.trim();
    if (supplierCode === '' || [...supplierCode].length > MAX_SUPPLIER_CODE_LENGTH || CONTROL_CHARACTER.test(supplierCode)) {
      throw new RangeError(`A code of the supplier needs from 1 to ${MAX_SUPPLIER_CODE_LENGTH} characters, without control characters`);
    }
    const key = supplierCode.toLowerCase();
    if (seen.has(key)) {
      throw new RangeError(`The code ${supplierCode} is in the list twice`);
    }
    seen.add(key);
    if (entry.listCostE6 !== null && (!Number.isSafeInteger(entry.listCostE6) || entry.listCostE6 < 0 || entry.listCostE6 > MAX_ORDER_UNIT_COST_E6)) {
      throw new RangeError(`The list cost must be null or a whole number of millionths from 0 up to ${MAX_ORDER_UNIT_COST_E6}`);
    }
    return { supplierCode, listCostE6: entry.listCostE6, purchaseUnit: optionalText(entry.purchaseUnit, MAX_PURCHASE_UNIT_LENGTH, 'presentation') };
  });
}

function toCodes(rows: readonly LinkRow[]): SupplierCode[] {
  return rows.map((row) => ({ supplierCode: row.supplier_code, listCostE6: row.list_cost_e6, purchaseUnit: row.purchase_unit }));
}

/** Writes codes and their list costs for the audit log, such as "CM-5 50500000e6, CM-5B". */
function describeCodes(codes: readonly SupplierCode[]): string {
  return codes.map((code) => (code.listCostE6 === null ? code.supplierCode : `${code.supplierCode} ${code.listCostE6}e6`)).join(', ');
}

function sameCodes(left: readonly SupplierCode[], right: readonly SupplierCode[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const byCode = new Map(left.map((code) => [code.supplierCode.toLowerCase(), code]));
  return right.every((code) => {
    const other = byCode.get(code.supplierCode.toLowerCase());
    return other !== undefined && other.supplierCode === code.supplierCode && other.listCostE6 === code.listCostE6 && other.purchaseUnit === code.purchaseUnit;
  });
}

function groupLinks(rows: readonly LinkRow[], productId: string): SupplierProductLink[] {
  const links = new Map<string, { supplierId: string; supplierName: string; codes: SupplierCode[] }>();
  for (const row of rows) {
    const link = links.get(row.supplier_id) ?? { supplierId: row.supplier_id, supplierName: row.supplier_name, codes: [] };
    link.codes.push({ supplierCode: row.supplier_code, listCostE6: row.list_cost_e6, purchaseUnit: row.purchase_unit });
    links.set(row.supplier_id, link);
  }
  return [...links.values()].map((link) => ({ ...link, productId }));
}
