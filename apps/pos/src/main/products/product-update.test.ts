import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lineTotals, quantityOf, saleTotals, taxRateOf } from '@pos-saas/money';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { UserSummary } from '../../shared/auth';
import type { ProductPanelDetail, UpdateProductRequest } from '../../shared/product-admin';
import { AuditLog } from '../audit/audit-log';
import { AuthService } from '../auth/auth-service';
import { UserStore } from '../auth/user-store';
import { CashService } from '../cash/cash-service';
import { CashSessionStore } from '../cash/cash-session-store';
import { PendingSales } from '../checkout/pending-sales';
import type { SaleToSave } from '../checkout/sale-recorder';
import { InventoryService } from '../inventory/inventory-service';
import { StockStore } from '../inventory/stock-store';
import { LocalStore } from '../local-store/local-store';
import { ProductCatalog } from '../local-store/product-catalog';
import { SaleStore } from '../local-store/sale-store';
import { PriceChangeService } from '../pricing/price-change-service';
import { contractErrorsOfPushRequest } from '../sync/fakes/contract-validator';
import { registerIdOf } from '../sync/register-identity';
import { SyncOutbox } from '../sync/sync-outbox';
import { uuidV7 } from '../uuid-v7';
import { parseReactivateProductRequest, parseUpdateProductRequest } from './product-request';
import { ProductReader } from './product-reader';
import { ProductService } from './product-service';

const TENANT = 'tenant-a';
const SIXTEEN = taxRateOf('rate', 1600);

let directory: string;
let store: LocalStore;
let auth: AuthService;
let cash: CashService;
let catalog: ProductCatalog;
let reader: ProductReader;
let products: ProductService;
let prices: PriceChangeService;
let inventory: InventoryService;
let pending: PendingSales;
let sales: SaleStore;
let owner: UserSummary;
let cashier: UserSummary;
let tapeId: string;
let cableId: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'product-update-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  auth = new AuthService(new UserStore(store, TENANT));
  cash = new CashService(new CashSessionStore(store, TENANT), auth);
  catalog = new ProductCatalog(store, TENANT);
  reader = new ProductReader(store, TENANT);
  const audit = new AuditLog(store, TENANT);
  inventory = new InventoryService(store, TENANT, auth, new StockStore(store, TENANT), audit, catalog);
  products = new ProductService(store, TENANT, auth, audit, reader, catalog, inventory);
  prices = new PriceChangeService(store, TENANT, auth, catalog, audit);
  sales = new SaleStore(store, TENANT);
  pending = new PendingSales(catalog, sales, () => ({ cashierId: auth.currentUser()!.id, cashSessionId: cash.openSessionId()! }), { auth, audit }, prices);
  owner = auth.setupOwner('Mauricio', '4321');
  auth.login(owner.id, '4321');
  cashier = auth.createUser('Ana', 'cashier', '5555');
  cash.open(0);
  // A tape measure that has stock, and a cable that was just created and has no movements yet.
  const tape = products.create({
    name: 'Cinta métrica 5 m',
    unit: 'piece',
    unitPriceE4: 895_000,
    taxRate: { factor: 'rate', rateBp: 1600 },
    unitCostE6: 52_250_000,
    barcodes: ['7501234567890'],
    initialStockMilli: 12_000,
    isActive: true,
  });
  const cable = products.create({
    name: 'Cable THW',
    unit: 'piece',
    unitPriceE4: 125_000,
    taxRate: { factor: 'rate', rateBp: 1600 },
    unitCostE6: null,
    barcodes: [],
    initialStockMilli: null,
    isActive: true,
  });
  tapeId = tape.status === 'created' ? tape.product.id : '';
  cableId = cable.status === 'created' ? cable.product.id : '';
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function asCashier(): void {
  auth.logout();
  auth.login(cashier.id, '5555');
}

/** The product as the screen loaded it, with the edits on top. */
function edit(productId: string, changes: Partial<UpdateProductRequest> = {}): UpdateProductRequest {
  const current = reader.detail(productId)!;
  return {
    productId,
    expectedRevision: current.revision,
    name: current.name,
    unit: current.unit,
    taxRate: current.taxRate,
    unitCostE6: current.unitCostE6,
    isActive: current.isActive,
    barcodes: current.barcodes,
    ...changes,
  };
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

function updated(result: ReturnType<ProductService['update']>): ProductPanelDetail {
  if (result.status !== 'updated') {
    throw new Error(`Expected updated, got ${result.status}`);
  }
  return result.product;
}

describe('changing a product (E1-43)', () => {
  it('changes the name, the VAT and the cost, and returns the product as it is now with a new revision', () => {
    const before = reader.detail(tapeId)!;

    const product = updated(
      products.update(edit(tapeId, { name: '  Cinta métrica 8 m ', taxRate: { factor: 'exempt', rateBp: 0 }, unitCostE6: 60_000_000 })),
    );

    expect(product).toMatchObject({ name: 'Cinta métrica 8 m', taxRate: { factor: 'exempt', rateBp: 0 }, unitCostE6: 60_000_000, effectiveCostE6: 60_000_000, barcodes: ['7501234567890'] });
    expect(product.revision).toBe(before.revision + 1);
    expect(catalog.search('8 m', 5).map(({ id }) => id)).toEqual([tapeId]);
    expect(catalog.search('5 m', 5)).toEqual([]);
  });

  it('writes the old and the new value of every change in the audit log, with who asked and who approved', () => {
    products.update(edit(tapeId, { name: 'Cinta de 8 m', unitCostE6: null, taxRate: { factor: 'rate', rateBp: 800 } }));

    const entry = store.prepare("SELECT user_id, entity_id, detail FROM audit_log WHERE action = 'product.update'").get() as unknown as { user_id: string; entity_id: string; detail: string };

    expect(entry).toMatchObject({ user_id: owner.id, entity_id: tapeId });
    expect(entry.detail).toContain('name "Cinta métrica 5 m" -> "Cinta de 8 m"');
    expect(entry.detail).toContain('VAT 1600 basis points -> 800 basis points');
    expect(entry.detail).toContain('cost $52.25 -> no cost');
    expect(entry.detail).toContain(`approved by ${owner.id}`);
  });

  it('queues product.updated in the same transaction, following the push contract, with the price left out', () => {
    products.update(edit(tapeId, { name: 'Cinta de 8 m', barcodes: ['CINTA-8M'], unitCostE6: 1_000_000, taxRate: { factor: 'exempt', rateBp: 0 } }));
    const operations = new SyncOutbox(store, TENANT)
      .pending(100)
      .filter((operation) => operation.type === 'product.updated')
      .map(({ attempts: _attempts, ...operation }) => operation);

    expect(operations).toHaveLength(1);
    expect(contractErrorsOfPushRequest({ registerId: registerIdOf(store, TENANT), operations })).toEqual([]);
    expect(operations[0]?.payload).toMatchObject({
      productId: tapeId,
      changedBy: owner.id,
      authorizedBy: owner.id,
      changes: {
        name: { previous: 'Cinta métrica 5 m', new: 'Cinta de 8 m' },
        tax: { previous: { taxFactor: 'rate', taxRateBp: 1600 }, new: { taxFactor: 'exempt', taxRateBp: 0 } },
        unitCostE6: { previous: 52_250_000, new: 1_000_000 },
        barcodesAdded: ['CINTA-8M'],
        barcodesRemoved: ['7501234567890'],
      },
    });
    expect(operations[0]?.payload.changes).not.toHaveProperty('unitPriceE4');
  });

  it('writes nothing when it asks for what the product already is', () => {
    const result = products.update(edit(tapeId, { name: ' Cinta métrica 5 m ' }));

    expect(result).toMatchObject({ status: 'unchanged' });
    expect(actions('product.update')).toEqual([]);
    expect(queued('product.updated')).toBe(0);
    expect(reader.detail(tapeId)?.revision).toBe(1);
  });

  it('keeps all of it or none of it: if queueing fails, the product, the codes and the entry are undone', () => {
    store.transaction((connection) => {
      connection.exec(`CREATE TRIGGER break_outbox BEFORE INSERT ON sync_outbox WHEN NEW.type = 'product.updated' BEGIN SELECT RAISE(ABORT, 'outbox is down'); END;`);
    });
    const before = reader.detail(tapeId);

    expect(() => products.update(edit(tapeId, { name: 'Otro nombre', barcodes: ['NUEVO'] }))).toThrow();

    expect(reader.detail(tapeId)).toEqual(before);
    expect(catalog.findByCode('NUEVO')).toBeNull();
    expect(actions('product.update')).toEqual([]);
  });

  it('keeps all of it or none of it: if the audit entry cannot be written, nothing else changes', () => {
    store.transaction((connection) => {
      connection.exec(`CREATE TRIGGER break_audit BEFORE INSERT ON audit_log WHEN NEW.action = 'product.update' BEGIN SELECT RAISE(ABORT, 'disk full'); END;`);
    });
    const before = reader.detail(tapeId);

    expect(() => products.update(edit(tapeId, { name: 'Otro nombre' }))).toThrow('disk full');

    expect(reader.detail(tapeId)).toEqual(before);
    expect(queued('product.updated')).toBe(0);
  });

  it('leaves the sales already completed exactly as they were, even if the name, the VAT and the state change', () => {
    const quantity = quantityOf(2000, 'piece');
    const line = { id: uuidV7(), productId: tapeId, productName: 'Cinta métrica 5 m', quantity, unitPriceE4: 895_000, totals: lineTotals(895_000, quantity, SIXTEEN) };
    const totals = saleTotals([line.totals]);
    const sale: SaleToSave = {
      saleId: uuidV7(),
      idempotencyKey: uuidV7(),
      lines: [line],
      subtotalCents: totals.subtotalCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      cashSessionId: cash.openSessionId()!,
      cashierId: owner.id,
    };
    sales.savePendingPayment(sale);
    sales.markCompleted(sale.saleId, [{ method: 'cash', amountCents: totals.totalCents, reference: null }]);
    const snapshot = (): unknown[] => [
      ...store.prepare('SELECT * FROM sale ORDER BY id').all(),
      ...store.prepare('SELECT * FROM sale_line ORDER BY id').all(),
      ...store.prepare('SELECT * FROM payment ORDER BY id').all(),
      ...store.prepare('SELECT * FROM stock_movement ORDER BY id').all(),
    ];
    const before = snapshot();

    products.update(edit(tapeId, { name: 'Cinta de 8 m', taxRate: { factor: 'exempt', rateBp: 0 }, isActive: false }));

    expect(snapshot()).toEqual(before);
  });

  it('never edits the stock: the ledger has the same movements and the stock is the sum of it', () => {
    const before = count('SELECT count(*) AS total FROM stock_movement');

    products.update(edit(tapeId, { name: 'Cinta de 8 m' }));

    expect(count('SELECT count(*) AS total FROM stock_movement')).toBe(before);
    expect(reader.detail(tapeId)?.stockMilli).toBe(12_000);
  });
});

describe('who may change a product', () => {
  it('lets a cashier do it with the PIN of the owner, recording who asked and who approved', () => {
    asCashier();

    const result = products.update(edit(tapeId, { name: 'Cinta de 8 m', ownerPin: '4321' }));

    expect(result.status).toBe('updated');
    const queuedPayload = store.prepare("SELECT payload FROM sync_outbox WHERE type = 'product.updated'").get() as unknown as { payload: string };
    expect(JSON.parse(queuedPayload.payload)).toMatchObject({ changedBy: cashier.id, authorizedBy: owner.id });
    const entry = store.prepare("SELECT user_id FROM audit_log WHERE action = 'product.update'").get() as unknown as { user_id: string };
    expect(entry.user_id).toBe(cashier.id);
  });

  it('refuses a cashier without a PIN, changes nothing and writes the denial with what was tried', () => {
    asCashier();

    expect(products.update(edit(tapeId, { name: 'Cinta de 8 m' }))).toEqual({ status: 'authorization_required' });

    expect(reader.detail(tapeId)?.name).toBe('Cinta métrica 5 m');
    expect(actions('product.update')).toEqual(['product.update_denied']);
    const denial = store.prepare("SELECT user_id, detail FROM audit_log WHERE action = 'product.update_denied'").get() as unknown as { user_id: string; detail: string };
    expect(denial.user_id).toBe(cashier.id);
    expect(denial.detail).toContain('authorization_required');
    expect(denial.detail).toContain('name "Cinta métrica 5 m" -> "Cinta de 8 m"');
    expect(queued('product.updated')).toBe(0);
  });

  it('refuses a wrong PIN with the tries left, and the failed attempt stays in the audit log under the cashier', () => {
    asCashier();

    expect(products.update(edit(tapeId, { name: 'Cinta de 8 m', ownerPin: '0000' }))).toEqual({ status: 'wrong_pin', attemptsLeft: 4 });

    expect(reader.detail(tapeId)?.name).toBe('Cinta métrica 5 m');
    expect(actions('product.update')).toEqual(['product.update_denied']);
  });

  it('refuses the PIN of another cashier, because only an owner approves', () => {
    auth.createUser('Beto', 'cashier', '6666');
    asCashier();

    expect(products.update(edit(tapeId, { name: 'Cinta de 8 m', ownerPin: '6666' })).status).toBe('wrong_pin');
  });

  it('locks after too many wrong PINs, and the lock is also written down', () => {
    asCashier();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      products.update(edit(tapeId, { name: 'Cinta de 8 m', ownerPin: '0000' }));
    }

    expect(products.update(edit(tapeId, { name: 'Cinta de 8 m', ownerPin: '4321' })).status).toBe('locked');

    expect(actions('product.update').at(-1)).toBe('product.update_denied');
  });

  it('lets a cashier look at a product, its stock and its movements without any PIN', () => {
    asCashier();

    const detail = products.panelDetail(tapeId);

    expect(detail).toMatchObject({ name: 'Cinta métrica 5 m', stockMilli: 12_000, effectiveCostE6: 52_250_000, recentMovements: [{ type: 'opening_balance', quantityMilli: 12_000, balanceMilli: 12_000 }] });
  });

  it('refuses when nobody is signed in', () => {
    auth.logout();

    expect(() => products.update(edit(tapeId))).toThrow('signed in');
  });
});

describe('a product that changed while it was being edited', () => {
  it('does not overwrite: it answers stale with the product as it is now, and writes nothing', () => {
    const screenA = edit(tapeId, { name: 'Cinta A' });
    const screenB = edit(tapeId, { name: 'Cinta B' });

    expect(products.update(screenA).status).toBe('updated');
    const result = products.update(screenB);

    expect(result).toMatchObject({ status: 'stale', product: { name: 'Cinta A' } });
    expect(reader.detail(tapeId)?.name).toBe('Cinta A');
    expect(actions('product.update')).toEqual(['product.update']);
    expect(queued('product.updated')).toBe(1);
  });

  it('notices a price change made meanwhile, because the revision counts every change of the product', () => {
    const screen = edit(tapeId, { name: 'Cinta de 8 m' });

    prices.change({ productId: tapeId, previousUnitPriceE4: 895_000, newUnitPriceE4: 950_000 });

    expect(products.update(screen)).toMatchObject({ status: 'stale', product: { unitPriceE4: 950_000 } });
    expect(reader.detail(tapeId)?.name).toBe('Cinta métrica 5 m');
  });

  it('answers stale before asking a cashier for the PIN, so no attempt is wasted', () => {
    const screen = edit(tapeId, { name: 'Cinta de 8 m' });
    products.update(edit(tapeId, { name: 'Cinta A' }));
    asCashier();

    expect(products.update(screen).status).toBe('stale');
    expect(actions('product.update')).toEqual(['product.update']);
  });

  it('answers not_found for a product that does not exist', () => {
    expect(products.update({ ...edit(tapeId), productId: uuidV7() })).toEqual({ status: 'not_found' });
  });
});

describe('barcodes', () => {
  it('adds a code and removes another in one change, and the sale finds the product by the new one only', () => {
    products.update(edit(tapeId, { barcodes: ['CINTA-8M'] }));

    expect(catalog.findByCode('CINTA-8M')?.id).toBe(tapeId);
    expect(catalog.findByCode('7501234567890')).toBeNull();
    expect(reader.detail(tapeId)?.barcodes).toEqual(['CINTA-8M']);
  });

  it('frees a code that was removed, so another product can use it', () => {
    products.update(edit(tapeId, { barcodes: [] }));

    expect(products.update(edit(cableId, { barcodes: ['7501234567890'] })).status).toBe('updated');
    expect(catalog.findByCode('7501234567890')?.id).toBe(cableId);
  });

  it('refuses a code another product already has, naming that product, and writes nothing', () => {
    const result = products.update(edit(cableId, { name: 'Cable nuevo', barcodes: ['SIN-USO', '7501234567890'] }));

    expect(result).toEqual({ status: 'duplicate_code', code: '7501234567890', productId: tapeId, productName: 'Cinta métrica 5 m' });
    expect(reader.detail(cableId)).toMatchObject({ name: 'Cable THW', barcodes: [] });
    expect(catalog.findByCode('SIN-USO')).toBeNull();
  });

  it('lets another product use the code of a product that was given up (E1-62)', () => {
    products.update(edit(tapeId, { isActive: false }));

    expect(updated(products.update(edit(cableId, { barcodes: ['7501234567890'] }))).barcodes).toEqual(['7501234567890']);
    expect(catalog.findByCode('7501234567890')?.id).toBe(cableId);
  });

  it('does not tell the product off for a code it already has', () => {
    expect(products.update(edit(tapeId, { name: 'Cinta de 8 m', barcodes: ['7501234567890'] })).status).toBe('updated');
  });

  it.each([
    ['repeated', ['1', '1']],
    ['with a space', ['1 2']],
    ['empty', ['']],
    ['too long', ['1'.repeat(65)]],
  ])('refuses a code that is %s', (_name, barcodes) => {
    expect(() => products.update(edit(tapeId, { barcodes }))).toThrow(RangeError);
  });
});

describe('the unit', () => {
  it('cannot change once the product has movements, and the answer says how many', () => {
    expect(products.update(edit(tapeId, { unit: 'meter' }))).toEqual({ status: 'unit_locked', movementCount: 1 });

    expect(reader.detail(tapeId)?.unit).toBe('piece');
    expect(actions('product.update')).toEqual([]);
    expect(queued('product.updated')).toBe(0);
  });

  it('also stays locked when the only movements are an adjustment, and when a sale moved the stock', () => {
    inventory.adjust({ productId: cableId, type: 'adjustment', quantityMilli: 3_000, reason: 'Count' });

    expect(products.update(edit(cableId, { unit: 'meter' })).status).toBe('unit_locked');
  });

  it('can change while the product has no movements, and the new unit is the one the stock is counted in', () => {
    expect(updated(products.update(edit(cableId, { unit: 'meter' }))).unit).toBe('meter');

    expect(inventory.adjust({ productId: cableId, type: 'adjustment', quantityMilli: 2_500, reason: 'Count' }).status).toBe('recorded');
    expect(reader.detail(cableId)).toMatchObject({ unit: 'meter', stockMilli: 2_500 });
  });
});

describe('giving a product up, and bringing it back', () => {
  it('hides it from the sale without deleting anything, keeps its history and releases its codes', () => {
    products.update(edit(tapeId, { isActive: false }));

    expect(reader.detail(tapeId)).toMatchObject({ isActive: false, stockMilli: 12_000, barcodes: [], releasedCodes: ['7501234567890'], movementCount: 1 });
    expect(catalog.findById(tapeId)).toBeNull();
    expect(catalog.findByCode('7501234567890')).toBeNull();
    expect(catalog.search('cinta', 10)).toEqual([]);
    expect(count(`SELECT count(*) AS total FROM product WHERE id = '${tapeId}'`)).toBe(1);
    expect(pending.save({ idempotencyKey: uuidV7(), lines: [{ productId: tapeId, quantityMilli: 1000 }], expectedTotalCents: 103_82 })).toEqual({ status: 'catalog_changed' });
  });

  it('is found by the panel, marked as given up, and can be activated again to be sold', () => {
    products.update(edit(tapeId, { isActive: false }));

    expect(products.find('cinta')).toEqual([{ id: tapeId, name: 'Cinta métrica 5 m', unit: 'piece', unitPriceE4: 895_000, isActive: false }]);
    expect(products.find('7501234567890').map(({ id }) => id)).toEqual([tapeId]);

    expect(updated(products.update(edit(tapeId, { isActive: true, barcodes: ['7501234567890'] }))).isActive).toBe(true);
    expect(catalog.findByCode('7501234567890')?.id).toBe(tapeId);
    expect(reader.detail(tapeId)?.releasedCodes).toEqual([]);
    const quantity = quantityOf(1000, 'piece');
    const total = saleTotals([lineTotals(895_000, quantity, SIXTEEN)]).totalCents;
    expect(pending.save({ idempotencyKey: uuidV7(), lines: [{ productId: tapeId, quantityMilli: 1000 }], expectedTotalCents: total }).status).toBe('saved');
  });

  it('never deletes the row: the table refuses nothing, but the service has no way to remove a product', () => {
    products.update(edit(tapeId, { isActive: false }));

    expect(count('SELECT count(*) AS total FROM product')).toBe(2);
    expect(products.find('cable').map(({ isActive }) => isActive)).toEqual([true]);
  });

  it('still lets the inventory of a given up product be corrected and read', () => {
    products.update(edit(tapeId, { isActive: false }));

    expect(inventory.adjust({ productId: tapeId, type: 'waste', quantityMilli: -1_000, reason: 'Broken' }).status).toBe('recorded');
    expect(inventory.kardex(tapeId)?.stockMilli).toBe(11_000);
  });
});

describe('the price and the stock keep their own flows', () => {
  it('changes the price with the same service as E1-39, which bumps the revision of the panel', () => {
    const before = reader.detail(tapeId)!;

    expect(prices.change({ productId: tapeId, previousUnitPriceE4: 895_000, newUnitPriceE4: 950_000 }).status).toBe('changed');

    expect(reader.detail(tapeId)).toMatchObject({ unitPriceE4: 950_000, revision: before.revision + 1 });
    expect(queued('product.price_changed')).toBe(1);
    expect(queued('product.updated')).toBe(0);
  });

  it('shows the cost the owner typed in preference to the last cost of the ledger, and falls back to the ledger', () => {
    expect(reader.detail(tapeId)).toMatchObject({ unitCostE6: 52_250_000, effectiveCostE6: 52_250_000 });
    products.update(edit(tapeId, { unitCostE6: null }));

    // The opening balance carried the cost, so without a typed cost the margin still has the last cost of the ledger.
    expect(reader.detail(tapeId)).toMatchObject({ unitCostE6: null, effectiveCostE6: 52_250_000 });
    expect(prices.info(tapeId)?.lastCostE6).toBe(52_250_000);
    products.update(edit(tapeId, { unitCostE6: 70_000_000 }));
    expect(prices.info(tapeId)?.lastCostE6).toBe(70_000_000);
  });

  it('lets a cashier write off stock with the PIN of an owner, written as who asked and who approved', () => {
    asCashier();

    expect(inventory.adjust({ productId: tapeId, type: 'waste', quantityMilli: -2_000, reason: 'Broken' })).toEqual({ status: 'authorization_required' });
    expect(inventory.adjust({ productId: tapeId, type: 'waste', quantityMilli: -2_000, reason: 'Broken', ownerPin: '0000' })).toEqual({ status: 'wrong_pin', attemptsLeft: 4 });
    expect(reader.detail(tapeId)?.stockMilli).toBe(12_000);
    expect(actions('stock.')).toEqual(['stock.adjust_denied', 'stock.adjust_denied']);

    expect(inventory.adjust({ productId: tapeId, type: 'waste', quantityMilli: -2_000, reason: 'Broken', ownerPin: '4321' }).status).toBe('recorded');

    expect(reader.detail(tapeId)?.stockMilli).toBe(10_000);
    const operations = new SyncOutbox(store, TENANT)
      .pending(100)
      .filter((operation) => operation.type === 'stock.adjusted')
      .map(({ attempts: _attempts, ...operation }) => operation);
    expect(contractErrorsOfPushRequest({ registerId: registerIdOf(store, TENANT), operations })).toEqual([]);
    expect(operations.at(-1)?.payload).toMatchObject({ userId: cashier.id, authorizedBy: owner.id });
  });
});

describe('what a valid change is', () => {
  it.each([
    ['an empty name', { name: ' ' }],
    ['a name that is too long', { name: 'a'.repeat(201) }],
    ['a VAT rate above 100%', { taxRate: { factor: 'rate' as const, rateBp: 10_001 } }],
    ['an exempt product with a rate', { taxRate: { factor: 'exempt' as const, rateBp: 1600 } }],
    ['a negative cost', { unitCostE6: -1 }],
    ['a cost with decimals', { unitCostE6: 1.5 }],
    ['a revision that is not a whole number', { expectedRevision: 1.5 }],
    ['a revision of zero', { expectedRevision: 0 }],
  ])('refuses %s, and nothing is written', (_name, change) => {
    expect(() => products.update(edit(tapeId, change))).toThrow(RangeError);

    expect(actions('product.update')).toEqual([]);
    expect(queued('product.updated')).toBe(0);
  });

  it('checks the shape of what crosses the bridge', () => {
    const valid = { ...edit(tapeId), ownerPin: '4321' };

    expect(parseUpdateProductRequest(valid)).toEqual(valid);
    expect(() => parseUpdateProductRequest({ ...valid, productId: 'nope' })).toThrow(TypeError);
    expect(() => parseUpdateProductRequest({ ...valid, expectedRevision: '1' })).toThrow(TypeError);
    expect(() => parseUpdateProductRequest({ ...valid, unit: 'box' })).toThrow(TypeError);
    expect(() => parseUpdateProductRequest({ ...valid, barcodes: 'abc' })).toThrow(TypeError);
    expect(() => parseUpdateProductRequest({ ...valid, isActive: 1 })).toThrow(TypeError);
    expect(() => parseUpdateProductRequest({ ...valid, unitCostE6: 'free' })).toThrow(TypeError);
    expect(() => parseUpdateProductRequest({ ...valid, ownerPin: '123456789' })).toThrow(TypeError);
    expect(() => parseUpdateProductRequest(null)).toThrow(TypeError);
  });
});

describe('a given-up product frees its name and its codes (E1-62)', () => {
  function giveUpTape(): void {
    updated(products.update(edit(tapeId, { isActive: false })));
  }

  function newTape(barcodes: readonly string[], name = 'Cinta métrica 5 m'): string {
    const result = products.create({
      name,
      unit: 'piece',
      unitPriceE4: 990_000,
      taxRate: { factor: 'rate', rateBp: 1600 },
      unitCostE6: null,
      barcodes,
      initialStockMilli: null,
      isActive: true,
    });
    if (result.status !== 'created') {
      throw new Error(`Expected created, got ${result.status}`);
    }
    return result.product.id;
  }

  function history(): { code: string; product_id: string; released_by: string; restored_by: string | null }[] {
    return store.prepare('SELECT code, product_id, released_by, restored_by FROM product_code_history ORDER BY released_at').all() as unknown as {
      code: string;
      product_id: string;
      released_by: string;
      restored_by: string | null;
    }[];
  }

  it('moves the codes to the history in the same change, with who gave the product up and when', () => {
    giveUpTape();

    expect(history()).toEqual([{ code: '7501234567890', product_id: tapeId, released_by: owner.id, restored_by: null }]);
    expect(count("SELECT count(*) AS total FROM product_barcode WHERE code = '7501234567890'")).toBe(0);
    const row = store.prepare('SELECT given_up_at, given_up_by FROM product WHERE id = ?').get(tapeId) as unknown as { given_up_at: string; given_up_by: string };
    expect(row.given_up_by).toBe(owner.id);
    expect(Number.isNaN(Date.parse(row.given_up_at))).toBe(false);
  });

  it('tells the core that the codes left the product, following the push contract', () => {
    giveUpTape();
    const operations = new SyncOutbox(store, TENANT)
      .pending(100)
      .filter((operation) => operation.type === 'product.updated')
      .map(({ attempts: _attempts, ...operation }) => operation);

    expect(contractErrorsOfPushRequest({ registerId: registerIdOf(store, TENANT), operations })).toEqual([]);
    expect(operations[0]?.payload.changes).toEqual({ isActive: { previous: true, new: false }, barcodesRemoved: ['7501234567890'] });
    expect(store.prepare("SELECT detail FROM audit_log WHERE action = 'product.update'").get()).toEqual({
      detail: expect.stringContaining('state active -> inactive; codes removed [7501234567890]'),
    });
  });

  it('lets a new product take the same code and the same name, and the sale finds the new one', () => {
    giveUpTape();
    const newId = newTape(['7501234567890']);

    expect(catalog.findByCode('7501234567890')).toMatchObject({ id: newId, unitPriceE4: 990_000 });
    expect(catalog.search('cinta', 10).map(({ id }) => id)).toEqual([newId]);
  });

  it('still finds the given-up product in the panel by the code it released, next to the one that has it now', () => {
    giveUpTape();
    const newId = newTape(['7501234567890']);

    expect(products.find('7501234567890').map(({ id, isActive }) => ({ id, isActive }))).toEqual(
      expect.arrayContaining([
        { id: tapeId, isActive: false },
        { id: newId, isActive: true },
      ]),
    );
    expect(catalog.productIdsThatHadCode(' 7501234567890 ').sort()).toEqual([tapeId, newId].sort());
  });

  it('refuses to give a product up with codes it did not have, because a given-up product holds none', () => {
    expect(() => products.update(edit(tapeId, { isActive: false, barcodes: ['7501234567890', 'OTRO'] }))).toThrow(RangeError);
    giveUpTape();
    expect(() => products.update(edit(tapeId, { barcodes: ['OTRO'] }))).toThrow(RangeError);
    expect(history()).toHaveLength(1);
  });

  it('reactivates with the released codes that are still free, and marks them restored in the history', () => {
    giveUpTape();
    const preview = products.previewReactivation(tapeId)!;
    expect(preview).toMatchObject({ name: 'Cinta métrica 5 m', releasedCodes: [{ code: '7501234567890', takenBy: null }], nameTakenBy: null });

    const result = products.reactivate({ productId: tapeId, expectedRevision: preview.revision, name: preview.name, restoreCodes: ['7501234567890'] });

    expect(result).toMatchObject({ status: 'reactivated', product: { isActive: true, barcodes: ['7501234567890'], releasedCodes: [] } });
    expect(catalog.findByCode('7501234567890')?.id).toBe(tapeId);
    expect(history()).toEqual([{ code: '7501234567890', product_id: tapeId, released_by: owner.id, restored_by: owner.id }]);
    expect(store.prepare('SELECT given_up_at FROM product WHERE id = ?').get(tapeId)).toEqual({ given_up_at: null });
  });

  it('never takes a code that another product uses now: it explains who has it and writes nothing', () => {
    giveUpTape();
    const newId = newTape(['7501234567890'], 'Flexómetro 5 m');
    const preview = products.previewReactivation(tapeId)!;
    expect(preview.releasedCodes).toEqual([{ code: '7501234567890', takenBy: { productId: newId, productName: 'Flexómetro 5 m' } }]);
    const revision = preview.revision;

    expect(products.reactivate({ productId: tapeId, expectedRevision: revision, name: preview.name, restoreCodes: ['7501234567890'] })).toEqual({
      status: 'code_taken',
      code: '7501234567890',
      productId: newId,
      productName: 'Flexómetro 5 m',
    });
    expect(reader.detail(tapeId)).toMatchObject({ isActive: false, revision });
    expect(catalog.findByCode('7501234567890')?.id).toBe(newId);
  });

  it('reactivates without the taken code, which stays released and keeps finding its old sales', () => {
    giveUpTape();
    const newId = newTape(['7501234567890'], 'Flexómetro 5 m');
    const preview = products.previewReactivation(tapeId)!;

    const result = products.reactivate({ productId: tapeId, expectedRevision: preview.revision, name: preview.name, restoreCodes: [] });

    expect(result).toMatchObject({ status: 'reactivated', product: { isActive: true, barcodes: [], releasedCodes: ['7501234567890'] } });
    expect(catalog.findByCode('7501234567890')?.id).toBe(newId);
    expect(catalog.productIdsThatHadCode('7501234567890').sort()).toEqual([tapeId, newId].sort());
  });

  it('asks for another name when an active product has the same one, ignoring the case', () => {
    giveUpTape();
    newTape([], 'CINTA MÉTRICA 5 m');
    const preview = products.previewReactivation(tapeId)!;
    expect(preview.nameTakenBy).toMatchObject({ productName: 'CINTA MÉTRICA 5 m' });

    expect(products.reactivate({ productId: tapeId, expectedRevision: preview.revision, name: preview.name, restoreCodes: [] })).toMatchObject({ status: 'name_taken' });
    expect(reader.detail(tapeId)?.isActive).toBe(false);

    const result = products.reactivate({ productId: tapeId, expectedRevision: preview.revision, name: 'Cinta métrica 5 m (vieja)', restoreCodes: ['7501234567890'] });
    expect(result).toMatchObject({ status: 'reactivated', product: { name: 'Cinta métrica 5 m (vieja)', barcodes: ['7501234567890'] } });
  });

  it('refuses a code the product never released, and answers for a product that is active, changed or missing', () => {
    giveUpTape();
    const { revision } = reader.detail(tapeId)!;
    expect(() => products.reactivate({ productId: tapeId, expectedRevision: revision, name: 'Cinta', restoreCodes: ['AJENO'] })).toThrow(RangeError);
    expect(products.reactivate({ productId: tapeId, expectedRevision: revision - 1, name: 'Cinta', restoreCodes: [] }).status).toBe('stale');
    expect(products.reactivate({ productId: cableId, expectedRevision: 1, name: 'Cable THW', restoreCodes: [] }).status).toBe('already_active');
    expect(products.reactivate({ productId: uuidV7(), expectedRevision: 1, name: 'X', restoreCodes: [] })).toEqual({ status: 'not_found' });
    expect(products.previewReactivation(uuidV7())).toBeNull();
  });

  it('lets a cashier reactivate only with the PIN of an owner', () => {
    giveUpTape();
    const { revision } = reader.detail(tapeId)!;
    asCashier();

    expect(products.reactivate({ productId: tapeId, expectedRevision: revision, name: 'Cinta métrica 5 m', restoreCodes: [] })).toEqual({ status: 'authorization_required' });
    expect(products.reactivate({ productId: tapeId, expectedRevision: revision, name: 'Cinta métrica 5 m', restoreCodes: [], ownerPin: '4321' }).status).toBe('reactivated');
  });

  it('lists the given-up products with who and when, last price and cost, the stock left and the released codes', () => {
    giveUpTape();

    expect(products.listGivenUp()).toEqual({
      status: 'listed',
      products: [
        {
          id: tapeId,
          name: 'Cinta métrica 5 m',
          unit: 'piece',
          givenUpAt: expect.any(String),
          givenUpByName: 'Mauricio',
          unitPriceE4: 895_000,
          effectiveCostE6: 52_250_000,
          stockMilli: 12_000,
          releasedCodes: ['7501234567890'],
        },
      ],
    });
  });

  it('lists a product created as inactive too, and shows a cashier the list only with the PIN of an owner', () => {
    newTape([], 'Pala cuadrada');
    const created = products.create({
      name: 'Pico',
      unit: 'piece',
      unitPriceE4: 100_000,
      taxRate: { factor: 'rate', rateBp: 1600 },
      unitCostE6: null,
      barcodes: [],
      initialStockMilli: null,
      isActive: false,
    });
    expect(created.status).toBe('created');
    asCashier();

    expect(products.listGivenUp()).toEqual({ status: 'authorization_required' });
    expect(actions('product.list_given_up_denied')).toEqual(['product.list_given_up_denied']);
    const listed = products.listGivenUp('4321');
    expect(listed.status === 'listed' ? listed.products.map(({ name, givenUpByName }) => ({ name, givenUpByName })) : []).toEqual([{ name: 'Pico', givenUpByName: 'Mauricio' }]);
  });

  it('checks the shape of a reactivation that crosses the bridge', () => {
    const valid = { productId: tapeId, expectedRevision: 3, name: 'Cinta', restoreCodes: ['1'], ownerPin: '4321' };
    expect(parseReactivateProductRequest(valid)).toEqual(valid);
    expect(() => parseReactivateProductRequest({ ...valid, productId: 'x' })).toThrow(TypeError);
    expect(() => parseReactivateProductRequest({ ...valid, restoreCodes: 'abc' })).toThrow(TypeError);
    expect(() => parseReactivateProductRequest({ ...valid, ownerPin: 1234 })).toThrow(TypeError);
  });
});
