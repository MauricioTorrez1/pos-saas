import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { UserSummary } from '../../shared/auth';
import type { OrderCandidate, OrderLineRequest, PurchaseOrder, SaveOrderRequest, Supplier } from '../../shared/supplier-order';
import { AuditLog } from '../audit/audit-log';
import { AuthService } from '../auth/auth-service';
import { UserStore } from '../auth/user-store';
import { InventoryService } from '../inventory/inventory-service';
import { StockStore } from '../inventory/stock-store';
import { LocalStore } from '../local-store/local-store';
import { ProductCatalog } from '../local-store/product-catalog';
import { ProductReader } from '../products/product-reader';
import { ProductService } from '../products/product-service';
import { contractErrorsOfPushRequest } from '../sync/fakes/contract-validator';
import { registerIdOf } from '../sync/register-identity';
import { SyncOutbox } from '../sync/sync-outbox';
import { PurchaseOrderService, suggestedQuantity } from './purchase-order-service';
import { SupplierService } from './supplier-service';

const TENANT = 'tenant-a';
const SIXTEEN = { factor: 'rate', rateBp: 1600 } as const;

let directory: string;
let store: LocalStore;
let auth: AuthService;
let suppliers: SupplierService;
let orders: PurchaseOrderService;
let owner: UserSummary;
let cashier: UserSummary;
let tapeId: string;
let cableId: string;
let nailsId: string;
let supplier: Supplier;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'purchasing-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  auth = new AuthService(new UserStore(store, TENANT));
  const catalog = new ProductCatalog(store, TENANT);
  const reader = new ProductReader(store, TENANT);
  const audit = new AuditLog(store, TENANT);
  const inventory = new InventoryService(store, TENANT, auth, new StockStore(store, TENANT), audit, catalog);
  const products = new ProductService(store, TENANT, auth, audit, reader, catalog, inventory);
  suppliers = new SupplierService(store, TENANT, auth, audit);
  orders = new PurchaseOrderService(store, TENANT, auth, audit, suppliers, reader, catalog);
  owner = auth.setupOwner('Mauricio', '4321');
  auth.login(owner.id, '4321');
  cashier = auth.createUser('Ana', 'cashier', '5555');

  const create = (name: string, unit: 'piece' | 'meter', unitCostE6: number | null, barcodes: string[], stockMilli: number | null): string => {
    const result = products.create({ name, unit, unitPriceE4: 125_000, taxRate: SIXTEEN, unitCostE6, barcodes, initialStockMilli: stockMilli, isActive: true });
    if (result.status !== 'created') {
      throw new Error(`Could not create ${name}`);
    }
    return result.product.id;
  };
  tapeId = create('Cinta métrica 5 m', 'piece', 52_250_000, ['7501234567890'], 12_000);
  cableId = create('Cable THW calibre 12', 'meter', null, [], 40_000);
  nailsId = create('Clavo de acero 2 pulgadas', 'piece', 333_333, ['7500000000011'], 1_000);
  supplier = savedSupplier('Ferretera del Centro');
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function asCashier(): void {
  auth.logout();
  auth.login(cashier.id, '5555');
}

function savedSupplier(name: string): Supplier {
  const result = suppliers.save({ name, contact: null, notes: null, isActive: true });
  if (result.status !== 'saved') {
    throw new Error(`Expected saved, got ${result.status}`);
  }
  return result.supplier;
}

function count(sql: string): number {
  return (store.prepare(sql).get() as unknown as { total: number }).total;
}

function actions(prefix: string): string[] {
  return (store.prepare('SELECT action FROM audit_log WHERE action LIKE ? ORDER BY rowid').all(`${prefix}%`) as unknown as { action: string }[]).map((row) => row.action);
}

function queued(type: string): number {
  return count(`SELECT count(*) AS total FROM sync_outbox WHERE type = '${type}'`);
}

/** The operations of the purchase order, without the ones the products of the fixture queued. */
function purchasingOperations(): { opId: string; deviceSeq: number; type: string; schemaVersion: number; occurredAt: string; payload: Readonly<Record<string, unknown>> }[] {
  return new SyncOutbox(store, TENANT)
    .pending(100)
    .filter(({ type }) => !type.startsWith('product.'))
    .map(({ attempts: _attempts, ...operation }) => operation);
}

function line(productId: string, quantityMilli: number, unitCostE6: number | null, supplierCode: string | null = null): OrderLineRequest {
  return { productId, quantityMilli, unitCostE6, supplierCode };
}

function saveDraft(lines: readonly OrderLineRequest[], overrides: Partial<SaveOrderRequest> = {}): PurchaseOrder {
  const result = orders.save({ supplierId: supplier.id, notes: null, lines, ...overrides });
  if (result.status !== 'saved') {
    throw new Error(`Expected saved, got ${result.status}`);
  }
  return result.order;
}

function names(candidates: readonly OrderCandidate[]): string[] {
  return candidates.map((candidate) => candidate.name);
}

describe('suppliers (E1-44)', () => {
  it('adds a supplier with its audit entry and its operation, and finds it by name ignoring capitals', () => {
    const added = savedSupplier('  Pinturas Rápidas ');

    expect(added).toMatchObject({ name: 'Pinturas Rápidas', contact: null, notes: null, isActive: true, revision: 1 });
    expect(suppliers.list(false).map(({ name }) => name)).toEqual(['Ferretera del Centro', 'Pinturas Rápidas']);
    expect(actions('supplier.')).toEqual(['supplier.create', 'supplier.create']);
    expect(queued('supplier.upserted')).toBe(2);
  });

  it('refuses a name another supplier has, ignoring capitals, and writes nothing', () => {
    const result = suppliers.save({ name: 'FERRETERA DEL CENTRO', contact: null, notes: null, isActive: true });

    expect(result).toEqual({ status: 'duplicate_name', supplierId: supplier.id, name: 'Ferretera del Centro' });
    expect(suppliers.list(true)).toHaveLength(1);
    expect(queued('supplier.upserted')).toBe(1);
  });

  it('changes a supplier with the revision the screen saw and refuses an old copy', () => {
    const changed = suppliers.save({ supplierId: supplier.id, expectedRevision: 1, name: supplier.name, contact: '55 1234 5678', notes: ' Cierra a las 6 ', isActive: true });

    expect(changed).toMatchObject({ status: 'saved', supplier: { contact: '55 1234 5678', notes: 'Cierra a las 6', revision: 2 } });
    const stale = suppliers.save({ supplierId: supplier.id, expectedRevision: 1, name: 'Otro nombre', contact: null, notes: null, isActive: true });
    expect(stale).toMatchObject({ status: 'stale', supplier: { name: 'Ferretera del Centro', revision: 2 } });
    expect(suppliers.save({ supplierId: supplier.id, expectedRevision: 2, name: supplier.name, contact: '55 1234 5678', notes: 'Cierra a las 6', isActive: true }).status).toBe('unchanged');
    expect(actions('supplier.')).toEqual(['supplier.create', 'supplier.update']);
  });

  it('gives a supplier up without deleting it, and a given up supplier is not offered', () => {
    suppliers.save({ supplierId: supplier.id, expectedRevision: 1, name: supplier.name, contact: null, notes: null, isActive: false });

    expect(suppliers.list(false)).toEqual([]);
    expect(suppliers.list(true)).toMatchObject([{ name: 'Ferretera del Centro', isActive: false }]);
    expect(orders.save({ supplierId: supplier.id, notes: null, lines: [] })).toEqual({ status: 'supplier_not_found' });
  });

  it('queues supplier.upserted following the push contract, with who asked and who approved', () => {
    const operations = purchasingOperations();

    expect(operations.map(({ type }) => type)).toEqual(['supplier.upserted']);
    expect(contractErrorsOfPushRequest({ registerId: registerIdOf(store, TENANT), operations })).toEqual([]);
    expect(operations[0]?.payload).toMatchObject({ supplierId: supplier.id, name: 'Ferretera del Centro', revision: 1, savedBy: owner.id, authorizedBy: owner.id });
  });

  it('keeps all of it or none of it: if queueing fails, the supplier and its entry are undone', () => {
    store.transaction((connection) => {
      connection.exec(`CREATE TRIGGER break_outbox BEFORE INSERT ON sync_outbox WHEN NEW.type = 'supplier.upserted' BEGIN SELECT RAISE(ABORT, 'outbox is down'); END;`);
    });

    expect(() => suppliers.save({ name: 'Otro proveedor', contact: null, notes: null, isActive: true })).toThrow('outbox is down');

    expect(suppliers.list(true)).toHaveLength(1);
    expect(actions('supplier.')).toEqual(['supplier.create']);
  });

  it('needs the PIN of an owner from a cashier, and writes every refusal in the audit log', () => {
    asCashier();

    expect(suppliers.save({ name: 'Nuevo', contact: null, notes: null, isActive: true })).toEqual({ status: 'authorization_required' });
    expect(suppliers.save({ name: 'Nuevo', contact: null, notes: null, isActive: true, ownerPin: '0000' })).toMatchObject({ status: 'wrong_pin' });
    expect(suppliers.list(true)).toHaveLength(1);
    expect(actions('supplier.save_denied')).toHaveLength(2);

    const approved = suppliers.save({ name: 'Nuevo', contact: null, notes: null, isActive: true, ownerPin: '4321' });
    expect(approved.status).toBe('saved');
    const payload = new SyncOutbox(store, TENANT).pending(100).at(-1)?.payload;
    expect(payload).toMatchObject({ savedBy: cashier.id, authorizedBy: owner.id });
  });

  it('refuses a name that is empty or too long', () => {
    expect(() => suppliers.save({ name: '   ', contact: null, notes: null, isActive: true })).toThrow(RangeError);
    expect(() => suppliers.save({ name: 'x'.repeat(101), contact: null, notes: null, isActive: true })).toThrow(RangeError);
  });
});

describe('the codes of a supplier for a product (E1-44)', () => {
  it('sets several codes for one product, with a list cost and a presentation, and reads them back', () => {
    const result = suppliers.setCodes({
      supplierId: supplier.id,
      productId: tapeId,
      codes: [
        { supplierCode: ' CM-5 ', listCostE6: 50_500_000, purchaseUnit: ' Caja con 12 ' },
        { supplierCode: '000123', listCostE6: null, purchaseUnit: null },
      ],
    });

    expect(result).toMatchObject({ status: 'saved', links: [{ supplierName: 'Ferretera del Centro', productId: tapeId, codes: [{ supplierCode: '000123' }, { supplierCode: 'CM-5', listCostE6: 50_500_000, purchaseUnit: 'Caja con 12' }] }] });
    expect(suppliers.linksOfProduct(tapeId)[0]?.codes).toHaveLength(2);
    expect(actions('supplier_codes.')).toEqual(['supplier_codes.set']);
  });

  it('replaces the list, removes it with an empty one, and answers unchanged when nothing differs', () => {
    const codes = [{ supplierCode: 'CM-5', listCostE6: null, purchaseUnit: null }];
    suppliers.setCodes({ supplierId: supplier.id, productId: tapeId, codes });

    expect(suppliers.setCodes({ supplierId: supplier.id, productId: tapeId, codes: [{ supplierCode: 'cm-5', listCostE6: null, purchaseUnit: null }] }).status).toBe('saved');
    expect(suppliers.setCodes({ supplierId: supplier.id, productId: tapeId, codes: [{ supplierCode: 'cm-5', listCostE6: null, purchaseUnit: null }] }).status).toBe('unchanged');
    expect(suppliers.setCodes({ supplierId: supplier.id, productId: tapeId, codes: [] })).toMatchObject({ status: 'saved', links: [] });
    expect(queued('supplier_product.upserted')).toBe(3);
  });

  it('refuses a code that repeats inside one list, ignoring capitals, an empty one and a negative cost', () => {
    const attempt = (codes: { supplierCode: string; listCostE6: number | null; purchaseUnit: string | null }[]): void => {
      suppliers.setCodes({ supplierId: supplier.id, productId: tapeId, codes });
    };

    expect(() => attempt([{ supplierCode: 'A1', listCostE6: null, purchaseUnit: null }, { supplierCode: 'a1', listCostE6: null, purchaseUnit: null }])).toThrow('twice');
    expect(() => attempt([{ supplierCode: '  ', listCostE6: null, purchaseUnit: null }])).toThrow(RangeError);
    expect(() => attempt([{ supplierCode: 'A1', listCostE6: -1, purchaseUnit: null }])).toThrow(RangeError);
    expect(suppliers.linksOfProduct(tapeId)).toEqual([]);
  });

  it('lets two products share a code of the same supplier, and two suppliers use the same code', () => {
    const other = savedSupplier('Tornillos del Norte');
    suppliers.setCodes({ supplierId: supplier.id, productId: tapeId, codes: [{ supplierCode: 'X-1', listCostE6: null, purchaseUnit: null }] });
    suppliers.setCodes({ supplierId: supplier.id, productId: nailsId, codes: [{ supplierCode: 'X-1', listCostE6: null, purchaseUnit: null }] });
    suppliers.setCodes({ supplierId: other.id, productId: cableId, codes: [{ supplierCode: 'X-1', listCostE6: null, purchaseUnit: null }] });

    expect(names(orders.search({ supplierId: supplier.id, text: 'x-1' })).sort()).toEqual(['Cinta métrica 5 m', 'Clavo de acero 2 pulgadas']);
    expect(names(orders.search({ supplierId: other.id, text: 'X-1' }))).toEqual(['Cable THW calibre 12']);
  });

  it('queues supplier_product.upserted following the push contract', () => {
    suppliers.setCodes({ supplierId: supplier.id, productId: tapeId, codes: [{ supplierCode: 'CM-5', listCostE6: 50_500_000, purchaseUnit: 'Caja con 12' }] });
    suppliers.setCodes({ supplierId: supplier.id, productId: nailsId, codes: [] });
    const operations = purchasingOperations();

    expect(operations.map(({ type }) => type)).toEqual(['supplier.upserted', 'supplier_product.upserted']);
    expect(contractErrorsOfPushRequest({ registerId: registerIdOf(store, TENANT), operations })).toEqual([]);
  });

  it('needs an owner, answers when the supplier or the product does not exist, and keeps codes with the product', () => {
    expect(suppliers.setCodes({ supplierId: '0193a5c0-0000-7000-8000-000000000999', productId: tapeId, codes: [] })).toEqual({ status: 'supplier_not_found' });
    expect(suppliers.setCodes({ supplierId: supplier.id, productId: '0193a5c0-0000-7000-8000-000000000999', codes: [] })).toEqual({ status: 'product_not_found' });
    asCashier();

    expect(suppliers.setCodes({ supplierId: supplier.id, productId: tapeId, codes: [{ supplierCode: 'A', listCostE6: null, purchaseUnit: null }] })).toEqual({ status: 'authorization_required' });
    expect(actions('supplier_codes.set_denied')).toHaveLength(1);
    expect(suppliers.linksOfProduct(tapeId)).toEqual([]);
  });
});

describe('finding products for an order (E1-44)', () => {
  beforeEach(() => {
    suppliers.setCodes({ supplierId: supplier.id, productId: tapeId, codes: [{ supplierCode: 'CM-5', listCostE6: 50_500_000, purchaseUnit: 'Caja con 12' }, { supplierCode: 'CM-5B', listCostE6: null, purchaseUnit: null }] });
  });

  it('finds by the words of the name, with the stock, the cost and the codes of the supplier', () => {
    const [found] = orders.search({ supplierId: supplier.id, text: 'cinta' });

    expect(found).toMatchObject({
      productId: tapeId,
      name: 'Cinta métrica 5 m',
      unit: 'piece',
      barcode: '7501234567890',
      stockMilli: 12_000,
      matchedBy: 'name',
      // The list cost of the supplier wins over the cost of the product.
      estimatedCostE6: 50_500_000,
      supplierCodes: [{ supplierCode: 'CM-5' }, { supplierCode: 'CM-5B' }],
    });
  });

  it('finds by the barcode a scanner reads, which is an exact match', () => {
    expect(orders.search({ supplierId: supplier.id, text: ' 7500000000011 ' })).toMatchObject([{ name: 'Clavo de acero 2 pulgadas', matchedBy: 'barcode', estimatedCostE6: 333_333, supplierCodes: [] }]);
  });

  it('finds by the code of the supplier, ignoring capitals, and puts the code that was typed first', () => {
    expect(orders.search({ supplierId: supplier.id, text: 'cm-5b' })).toMatchObject([{ name: 'Cinta métrica 5 m', matchedBy: 'supplier_code', supplierCodes: [{ supplierCode: 'CM-5B' }, { supplierCode: 'CM-5' }] }]);
  });

  it('does not find a code of a supplier when the search is not for that supplier, and falls back to names', () => {
    const other = savedSupplier('Otro');

    expect(orders.search({ supplierId: other.id, text: 'CM-5' })).toEqual([]);
    expect(orders.search({ supplierId: null, text: 'CM-5' })).toEqual([]);
    expect(names(orders.search({ supplierId: null, text: 'cable' }))).toEqual(['Cable THW calibre 12']);
  });

  it('answers an empty search with nothing, and does not offer the products that were given up', () => {
    expect(orders.search({ supplierId: supplier.id, text: '   ' })).toEqual([]);
    store.transaction((connection) => {
      connection.exec(`UPDATE product SET is_active = 0 WHERE id = '${tapeId}'`);
    });

    expect(orders.search({ supplierId: supplier.id, text: 'CM-5' })).toEqual([]);
    expect(orders.search({ supplierId: supplier.id, text: 'cinta' })).toEqual([]);
  });
});

describe('reorder levels and suggestions (E1-44)', () => {
  it('works out the suggestion: up to the maximum, or to twice the minimum, and nothing above the minimum', () => {
    expect(suggestedQuantity(2_000, 5_000, null)).toBe(8_000);
    expect(suggestedQuantity(2_000, 5_000, 20_000)).toBe(18_000);
    expect(suggestedQuantity(5_000, 5_000, null)).toBe(5_000);
    expect(suggestedQuantity(5_001, 5_000, null)).toBeNull();
    expect(suggestedQuantity(-3_000, 5_000, null)).toBe(13_000);
    expect(suggestedQuantity(0, null, null)).toBeNull();
  });

  it('suggests nothing while no product has a level, so the screen can offer to set them', () => {
    expect(orders.suggest(supplier.id)).toEqual([]);
  });

  it('suggests what is at or below its minimum, with the quantity to fill, and leaves the rest alone', () => {
    orders.setReorderLevel({ productId: nailsId, minimumMilli: 5_000, maximumMilli: null });
    orders.setReorderLevel({ productId: tapeId, minimumMilli: 5_000, maximumMilli: 24_000 });

    const suggestions = orders.suggest(supplier.id);

    expect(suggestions).toMatchObject([{ name: 'Clavo de acero 2 pulgadas', stockMilli: 1_000, minimumMilli: 5_000, suggestedMilli: 9_000, matchedBy: 'low_stock' }]);
    expect(actions('reorder_level.')).toEqual(['reorder_level.set', 'reorder_level.set']);
  });

  it('suggests only what the supplier sells once it has codes, and never forces the quantity into an order', () => {
    orders.setReorderLevel({ productId: nailsId, minimumMilli: 5_000, maximumMilli: null });
    orders.setReorderLevel({ productId: cableId, minimumMilli: 50_000, maximumMilli: null });
    suppliers.setCodes({ supplierId: supplier.id, productId: cableId, codes: [{ supplierCode: 'THW-12', listCostE6: null, purchaseUnit: null }] });

    expect(names(orders.suggest(supplier.id))).toEqual(['Cable THW calibre 12']);
    expect(orders.list()).toEqual([]);
  });

  it('refuses a level that is not a whole quantity, or a maximum that is not above the minimum', () => {
    expect(() => orders.setReorderLevel({ productId: tapeId, minimumMilli: 0, maximumMilli: null })).toThrow(RangeError);
    expect(() => orders.setReorderLevel({ productId: tapeId, minimumMilli: 2_500, maximumMilli: null })).toThrow();
    expect(() => orders.setReorderLevel({ productId: tapeId, minimumMilli: 5_000, maximumMilli: 5_000 })).toThrow('above the minimum');
    expect(orders.setReorderLevel({ productId: '0193a5c0-0000-7000-8000-000000000999', minimumMilli: 1_000, maximumMilli: null })).toEqual({ status: 'product_not_found' });
  });

  it('needs an owner to set a level, and the refusal is written in the audit log', () => {
    asCashier();

    expect(orders.setReorderLevel({ productId: tapeId, minimumMilli: 1_000, maximumMilli: null })).toEqual({ status: 'authorization_required' });
    expect(orders.setReorderLevel({ productId: tapeId, minimumMilli: 1_000, maximumMilli: null, ownerPin: '4321' }).status).toBe('saved');
    expect(actions('reorder_level.')).toEqual(['reorder_level.set_denied', 'reorder_level.set']);
  });
});

describe('saving, reopening and sending an order (E1-44)', () => {
  it('saves a draft with a folio, copies of the name, the barcode and the code, and totals made of whole cents', () => {
    const order = saveDraft(
      [
        // 12 pieces at $52.25 is $627.00.
        line(tapeId, 12_000, 52_250_000, 'CM-5'),
        // 3 pieces at $0.333333 is $0.999999, which rounds half up to $1.00 (100 cents).
        line(nailsId, 3_000, 333_333),
        line(cableId, 2_500, null),
      ],
      { notes: '  Entregar en la bodega  ' },
    );

    expect(order).toMatchObject({ folio: 1, status: 'draft', supplierName: 'Ferretera del Centro', notes: 'Entregar en la bodega', revision: 1, sentAt: null, linesWithoutCost: 1 });
    expect(order.lines).toMatchObject([
      { lineNumber: 1, description: 'Cinta métrica 5 m', supplierCode: 'CM-5', barcode: '7501234567890', unit: 'piece', quantityMilli: 12_000, unitCostE6: 52_250_000, lineTotalCents: 62_700 },
      { lineNumber: 2, description: 'Clavo de acero 2 pulgadas', barcode: '7500000000011', lineTotalCents: 100 },
      { lineNumber: 3, description: 'Cable THW calibre 12', barcode: null, unit: 'meter', unitCostE6: null, lineTotalCents: null },
    ]);
    // 62,700 + 100 cents: the line without a cost is left out of the total, and nothing is a decimal number.
    expect(order.totalCents).toBe(62_800);
    expect(Number.isInteger(order.totalCents)).toBe(true);
    expect(actions('purchase_order.')).toEqual(['purchase_order.create']);
  });

  it('rounds a line half up in cents, like the lines of a sale', () => {
    // 2 pieces at $0.0025 each is half a cent: it rounds up to 1 cent.
    expect(saveDraft([line(tapeId, 2_000, 2_500)]).lines[0]?.lineTotalCents).toBe(1);
    // 3 pieces at $0.0025 is 0.75 of a cent: 1 cent. 1 piece is a quarter of a cent: 0.
    expect(saveDraft([line(tapeId, 3_000, 2_500)]).lines[0]?.lineTotalCents).toBe(1);
    expect(saveDraft([line(tapeId, 1_000, 2_500)]).lines[0]?.lineTotalCents).toBe(0);
  });

  it('numbers the orders from 1 without gaps, and reopens a draft exactly as it was saved', () => {
    const first = saveDraft([line(tapeId, 1_000, 52_250_000)]);
    const second = saveDraft([line(cableId, 1_500, 10_000_000)]);

    expect([first.folio, second.folio]).toEqual([1, 2]);
    expect(orders.get(first.id)).toEqual(first);
    expect(orders.list()).toMatchObject([
      { folio: 2, status: 'draft', lineCount: 1, totalCents: 1_500 },
      { folio: 1, status: 'draft', lineCount: 1, totalCents: 5_225 },
    ]);
  });

  it('edits a draft: replaces the lines, keeps the folio and goes up one revision', () => {
    const draft = saveDraft([line(tapeId, 1_000, 52_250_000), line(nailsId, 1_000, 333_333)]);

    const result = orders.save({ orderId: draft.id, expectedRevision: draft.revision, supplierId: supplier.id, notes: 'Urgente', lines: [line(cableId, 4_000, 10_000_000)] });

    expect(result).toMatchObject({ status: 'saved', order: { folio: 1, revision: 2, notes: 'Urgente', lines: [{ lineNumber: 1, description: 'Cable THW calibre 12', lineTotalCents: 4_000 }] } });
    expect(count('SELECT count(*) AS total FROM purchase_order_line')).toBe(1);
    expect(actions('purchase_order.')).toEqual(['purchase_order.create', 'purchase_order.update']);
  });

  it('refuses to overwrite a draft that changed after the screen loaded it', () => {
    const draft = saveDraft([line(tapeId, 1_000, null)]);
    orders.save({ orderId: draft.id, expectedRevision: 1, supplierId: supplier.id, notes: null, lines: [line(tapeId, 2_000, null)] });

    const stale = orders.save({ orderId: draft.id, expectedRevision: 1, supplierId: supplier.id, notes: null, lines: [line(tapeId, 9_000, null)] });

    expect(stale).toMatchObject({ status: 'stale', order: { revision: 2, lines: [{ quantityMilli: 2_000 }] } });
  });

  it('checks quantities and costs: above zero, whole pieces, and inside the limits', () => {
    expect(() => saveDraft([line(tapeId, 0, null)])).toThrow(RangeError);
    expect(() => saveDraft([line(tapeId, 2_500, null)])).toThrow();
    expect(() => saveDraft([line(cableId, 100_000_001, null)])).toThrow(RangeError);
    expect(() => saveDraft([line(tapeId, 1_000, -5)])).toThrow(RangeError);
    expect(() => saveDraft([line(tapeId, 1_000, 1.5)])).toThrow(RangeError);
    expect(saveDraft([line(cableId, 2_500, 1)]).lines[0]?.quantityMilli).toBe(2_500);
    expect(orders.save({ supplierId: supplier.id, notes: null, lines: [line('0193a5c0-0000-7000-8000-000000000999', 1_000, null)] })).toEqual({
      status: 'product_not_found',
      productId: '0193a5c0-0000-7000-8000-000000000999',
    });
  });

  it('writes nothing of the order when one line is wrong', () => {
    expect(() => saveDraft([line(tapeId, 1_000, null), line(tapeId, 0, null)])).toThrow(RangeError);

    expect(orders.list()).toEqual([]);
    expect(actions('purchase_order.')).toEqual([]);
  });

  it('marks it as sent: it keeps the history, queues the operation and never changes again', () => {
    const draft = saveDraft([line(tapeId, 12_000, 52_250_000, 'CM-5'), line(cableId, 2_500, null)], { notes: 'Urgente' });

    const result = orders.markSent({ orderId: draft.id, expectedRevision: draft.revision });

    expect(result).toMatchObject({ status: 'sent', order: { status: 'sent', revision: 2 } });
    const sent = orders.get(draft.id)!;
    expect(sent.sentAt).not.toBeNull();
    expect(actions('purchase_order.')).toEqual(['purchase_order.create', 'purchase_order.send']);
    expect(orders.list()).toMatchObject([{ folio: 1, status: 'sent' }]);
    expect(orders.markSent({ orderId: draft.id, expectedRevision: 2 })).toMatchObject({ status: 'already_sent' });
    expect(orders.save({ orderId: draft.id, expectedRevision: 2, supplierId: supplier.id, notes: null, lines: [] })).toMatchObject({ status: 'stale', order: { status: 'sent' } });
    expect(orders.discard({ orderId: draft.id, expectedRevision: 2 })).toMatchObject({ status: 'already_sent' });
  });

  it('makes a sent order and its lines impossible to change or delete, even by hand in the database', () => {
    const draft = saveDraft([line(tapeId, 1_000, 52_250_000)]);
    orders.markSent({ orderId: draft.id, expectedRevision: 1 });
    const attempt = (sql: string): void => {
      store.transaction((connection) => {
        connection.exec(sql);
      });
    };

    expect(() => attempt(`UPDATE purchase_order SET notes = 'changed' WHERE id = '${draft.id}'`)).toThrow('a sent order never changes');
    expect(() => attempt(`DELETE FROM purchase_order WHERE id = '${draft.id}'`)).toThrow('a sent order is never deleted');
    expect(() => attempt(`UPDATE purchase_order_line SET quantity_milli = 9000 WHERE order_id = '${draft.id}'`)).toThrow('the lines of a sent order never change');
    expect(() => attempt(`DELETE FROM purchase_order_line WHERE order_id = '${draft.id}'`)).toThrow('the lines of a sent order never change');
    expect(orders.get(draft.id)?.lines[0]?.quantityMilli).toBe(1_000);
  });

  it('queues purchase_order.sent following the push contract, with the copies and the approval', () => {
    const draft = saveDraft([line(tapeId, 12_000, 52_250_000, 'CM-5'), line(cableId, 2_500, null)], { notes: 'Urgente' });
    orders.markSent({ orderId: draft.id, expectedRevision: 1 });
    const operations = new SyncOutbox(store, TENANT)
      .pending(100)
      .filter(({ type }) => type === 'purchase_order.sent')
      .map(({ attempts: _attempts, ...operation }) => operation);

    expect(operations).toHaveLength(1);
    expect(contractErrorsOfPushRequest({ registerId: registerIdOf(store, TENANT), operations })).toEqual([]);
    expect(operations[0]?.payload).toMatchObject({
      orderId: draft.id,
      folio: 1,
      supplierId: supplier.id,
      supplierName: 'Ferretera del Centro',
      notes: 'Urgente',
      totalCents: 62_700,
      sentBy: owner.id,
      authorizedBy: owner.id,
      lines: [
        { lineNumber: 1, supplierCode: 'CM-5', barcode: '7501234567890', unit: 'piece', quantityMilli: 12_000, unitCostE6: 52_250_000, lineTotalCents: 62_700 },
        { lineNumber: 2, supplierCode: null, barcode: null, unit: 'meter', quantityMilli: 2_500, unitCostE6: null, lineTotalCents: null },
      ],
    });
  });

  it('does not queue anything for a draft, and an empty draft cannot be sent', () => {
    const draft = saveDraft([]);

    expect(queued('purchase_order.sent')).toBe(0);
    expect(orders.markSent({ orderId: draft.id, expectedRevision: 1 })).toEqual({ status: 'empty' });
    expect(orders.get(draft.id)?.status).toBe('draft');
  });

  it('moves no stock: an order is a document, and what arrives is posted by the reception', () => {
    const before = count('SELECT count(*) AS total FROM stock_movement');
    const draft = saveDraft([line(tapeId, 12_000, 52_250_000)]);
    orders.markSent({ orderId: draft.id, expectedRevision: 1 });

    expect(count('SELECT count(*) AS total FROM stock_movement')).toBe(before);
    expect(new ProductReader(store, TENANT).detail(tapeId)?.stockMilli).toBe(12_000);
  });

  it('keeps all of it or none of it when sending: if queueing fails, the order stays a draft and has no entry', () => {
    const draft = saveDraft([line(tapeId, 1_000, 52_250_000)]);
    store.transaction((connection) => {
      connection.exec(`CREATE TRIGGER break_outbox BEFORE INSERT ON sync_outbox WHEN NEW.type = 'purchase_order.sent' BEGIN SELECT RAISE(ABORT, 'outbox is down'); END;`);
    });

    expect(() => orders.markSent({ orderId: draft.id, expectedRevision: 1 })).toThrow('outbox is down');

    expect(orders.get(draft.id)).toMatchObject({ status: 'draft', revision: 1, sentAt: null });
    expect(actions('purchase_order.send')).toEqual([]);
  });

  it('keeps all of it or none of it when sending: if the audit entry fails, nothing is sent or queued', () => {
    const draft = saveDraft([line(tapeId, 1_000, 52_250_000)]);
    store.transaction((connection) => {
      connection.exec(`CREATE TRIGGER break_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'purchase_order.send' BEGIN SELECT RAISE(ABORT, 'disk full'); END;`);
    });

    expect(() => orders.markSent({ orderId: draft.id, expectedRevision: 1 })).toThrow('disk full');

    expect(orders.get(draft.id)?.status).toBe('draft');
    expect(queued('purchase_order.sent')).toBe(0);
  });

  it('keeps the lines of a draft if saving it fails halfway', () => {
    const draft = saveDraft([line(tapeId, 1_000, 52_250_000)]);
    store.transaction((connection) => {
      connection.exec(`CREATE TRIGGER break_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'purchase_order.update' BEGIN SELECT RAISE(ABORT, 'disk full'); END;`);
    });

    expect(() => orders.save({ orderId: draft.id, expectedRevision: 1, supplierId: supplier.id, notes: null, lines: [line(cableId, 1_000, null)] })).toThrow('disk full');

    expect(orders.get(draft.id)).toEqual(draft);
  });

  it('discards a draft and keeps the entry; a missing order answers not found', () => {
    const draft = saveDraft([line(tapeId, 1_000, null)]);

    expect(orders.discard({ orderId: draft.id, expectedRevision: 1 })).toEqual({ status: 'discarded' });

    expect(orders.get(draft.id)).toBeNull();
    expect(count('SELECT count(*) AS total FROM purchase_order_line')).toBe(0);
    expect(actions('purchase_order.')).toEqual(['purchase_order.create', 'purchase_order.discard']);
    expect(orders.discard({ orderId: draft.id, expectedRevision: 1 })).toEqual({ status: 'not_found' });
    expect(orders.markSent({ orderId: draft.id, expectedRevision: 1 })).toEqual({ status: 'not_found' });
  });

  it('does not reuse the folio of a discarded draft while a higher one exists', () => {
    const first = saveDraft([line(tapeId, 1_000, null)]);
    const second = saveDraft([line(tapeId, 1_000, null)]);
    orders.discard({ orderId: first.id, expectedRevision: 1 });

    expect(saveDraft([line(tapeId, 1_000, null)]).folio).toBe(second.folio + 1);
  });
});

describe('who may order (E1-44)', () => {
  it('lets a cashier read everything but needs the PIN of an owner to save, send and discard', () => {
    const draft = saveDraft([line(tapeId, 1_000, 52_250_000)]);
    asCashier();

    expect(orders.list()).toHaveLength(1);
    expect(orders.get(draft.id)?.lines).toHaveLength(1);
    expect(orders.save({ supplierId: supplier.id, notes: null, lines: [line(tapeId, 1_000, null)] })).toEqual({ status: 'authorization_required' });
    expect(orders.markSent({ orderId: draft.id, expectedRevision: 1 })).toEqual({ status: 'authorization_required' });
    expect(orders.discard({ orderId: draft.id, expectedRevision: 1 })).toEqual({ status: 'authorization_required' });
    expect(orders.markSent({ orderId: draft.id, expectedRevision: 1, ownerPin: '0000' })).toMatchObject({ status: 'wrong_pin', attemptsLeft: expect.any(Number) });
    expect(orders.get(draft.id)?.status).toBe('draft');
    expect(actions('purchase_order.').filter((action) => action.endsWith('_denied'))).toEqual([
      'purchase_order.save_denied',
      'purchase_order.send_denied',
      'purchase_order.discard_denied',
      'purchase_order.send_denied',
    ]);
  });

  it('records who asked and which owner approved when a cashier sends with the PIN', () => {
    const draft = saveDraft([line(tapeId, 1_000, 52_250_000)]);
    asCashier();

    expect(orders.markSent({ orderId: draft.id, expectedRevision: 1, ownerPin: '4321' }).status).toBe('sent');

    const entry = store.prepare("SELECT user_id, detail FROM audit_log WHERE action = 'purchase_order.send'").get() as unknown as { user_id: string; detail: string };
    expect(entry.user_id).toBe(cashier.id);
    expect(entry.detail).toContain(`approved by ${owner.id}`);
    expect(new SyncOutbox(store, TENANT).pending(100).at(-1)?.payload).toMatchObject({ sentBy: cashier.id, authorizedBy: owner.id });
  });

  it('refuses everything while nobody is signed in', () => {
    auth.logout();

    expect(() => orders.save({ supplierId: supplier.id, notes: null, lines: [] })).toThrow('signed in');
    expect(() => suppliers.save({ name: 'X', contact: null, notes: null, isActive: true })).toThrow('signed in');
  });
});
