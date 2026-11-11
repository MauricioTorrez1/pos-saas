import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lineTotals, quantityOf, saleTotals, taxRateOf } from '@pos-saas/money';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { UserSummary } from '../../shared/auth';
import { MAX_UNIT_PRICE_E4 } from '../../shared/pricing';
import type { NewProductRequest } from '../../shared/product-admin';
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
import { parseNewProductRequest } from './product-request';
import { ProductReader } from './product-reader';
import { ProductService } from './product-service';

const TENANT = 'tenant-a';
const UUID_V7_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SIXTEEN = taxRateOf('rate', 1600);

let directory: string;
let store: LocalStore;
let auth: AuthService;
let cash: CashService;
let catalog: ProductCatalog;
let reader: ProductReader;
let products: ProductService;
let pending: PendingSales;
let sales: SaleStore;
let owner: UserSummary;
let cashier: UserSummary;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'new-product-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  auth = new AuthService(new UserStore(store, TENANT));
  cash = new CashService(new CashSessionStore(store, TENANT), auth);
  catalog = new ProductCatalog(store, TENANT);
  reader = new ProductReader(store, TENANT);
  const audit = new AuditLog(store, TENANT);
  const inventory = new InventoryService(store, TENANT, auth, new StockStore(store, TENANT), audit, catalog);
  products = new ProductService(store, TENANT, auth, audit, reader, catalog, inventory);
  const prices = new PriceChangeService(store, TENANT, auth, catalog, audit);
  sales = new SaleStore(store, TENANT);
  pending = new PendingSales(
    catalog,
    sales,
    () => ({ cashierId: auth.currentUser()!.id, cashSessionId: cash.openSessionId()! }),
    { auth, audit },
    prices,
  );
  owner = auth.setupOwner('Mauricio', '4321');
  auth.login(owner.id, '4321');
  cashier = auth.createUser('Ana', 'cashier', '5555');
  cash.open(0);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function asCashier(): void {
  auth.logout();
  auth.login(cashier.id, '5555');
}

function newProduct(overrides: Partial<NewProductRequest> = {}): NewProductRequest {
  return {
    name: 'Cinta métrica 5 m',
    unit: 'piece',
    unitPriceE4: 895_000,
    taxRate: { factor: 'rate', rateBp: 1600 },
    unitCostE6: 52_250_000,
    barcodes: ['7501234567890'],
    initialStockMilli: 12_000,
    isActive: true,
    ...overrides,
  };
}

function count(sql: string): number {
  return (store.prepare(sql).get() as unknown as { total: number }).total;
}

function productCount(): number {
  return count('SELECT count(*) AS total FROM product');
}

function auditActions(): string[] {
  return (store.prepare("SELECT action FROM audit_log WHERE action LIKE 'product.%' ORDER BY rowid").all() as unknown as { action: string }[]).map((row) => row.action);
}

function queuedTypes(): string[] {
  return (store.prepare("SELECT type FROM sync_outbox WHERE type LIKE 'product.%' ORDER BY device_seq").all() as unknown as { type: string }[]).map((row) => row.type);
}

describe('adding a product (E1-42)', () => {
  it('writes the product, its codes and its first stock, and returns it whole', () => {
    const result = products.create(newProduct({ barcodes: ['7501234567890', 'CINTA-5M'] }));

    expect(result.status).toBe('created');
    if (result.status !== 'created') {
      return;
    }
    expect(result.product).toMatchObject({
      name: 'Cinta métrica 5 m',
      unit: 'piece',
      unitPriceE4: 895_000,
      taxRate: { factor: 'rate', rateBp: 1600 },
      unitCostE6: 52_250_000,
      effectiveCostE6: 52_250_000,
      isActive: true,
      revision: 1,
      barcodes: ['7501234567890', 'CINTA-5M'],
      stockMilli: 12_000,
      movementCount: 1,
    });
    expect(result.product.id).toMatch(UUID_V7_TEXT);
    expect(catalog.findByCode('CINTA-5M')?.id).toBe(result.product.id);
    expect(catalog.search('cinta', 10).map(({ id }) => id)).toEqual([result.product.id]);
  });

  it('posts the first stock as a movement of the ledger with its cost, never as a column', () => {
    const result = products.create(newProduct());
    const productId = result.status === 'created' ? result.product.id : '';

    const movements = store.prepare('SELECT type, quantity_milli, unit_cost_e6, source, source_id FROM stock_movement WHERE product_id = ?').all(productId);

    expect(movements).toEqual([{ type: 'opening_balance', quantity_milli: 12_000, unit_cost_e6: 52_250_000, source: 'product_creation', source_id: productId }]);
    expect(new StockStore(store, TENANT).levelOf(productId)).toBe(12_000);
  });

  it('starts with no movement and no stock when nothing was said about it', () => {
    const result = products.create(newProduct({ initialStockMilli: null, unitCostE6: null, barcodes: [] }));

    expect(result).toMatchObject({ status: 'created', product: { stockMilli: 0, movementCount: 0, unitCostE6: null, effectiveCostE6: null, barcodes: [] } });
    expect(count('SELECT count(*) AS total FROM stock_movement')).toBe(0);
  });

  it('counts a measured quantity with three decimals, with the Quantity rules of the unit', () => {
    const result = products.create(newProduct({ name: 'Cable', unit: 'meter', initialStockMilli: 12_500, barcodes: [] }));

    expect(result).toMatchObject({ status: 'created', product: { unit: 'meter', stockMilli: 12_500 } });
  });

  it('writes who did it and what, with the owner who approved, in the audit log', () => {
    const result = products.create(newProduct());
    const productId = result.status === 'created' ? result.product.id : '';

    const entry = store.prepare("SELECT user_id, entity_id, detail FROM audit_log WHERE action = 'product.create'").get() as unknown as { user_id: string; entity_id: string; detail: string };

    expect(entry).toMatchObject({ user_id: owner.id, entity_id: productId });
    expect(entry.detail).toContain('Cinta métrica 5 m');
    expect(entry.detail).toContain('$89.50 with VAT included (895000 ten-thousandths)');
    expect(entry.detail).toContain('codes [7501234567890]');
    expect(entry.detail).toContain('initial stock 12000 thousandths');
    expect(entry.detail).toContain(`approved by ${owner.id}`);
  });

  it('queues product.created in the same transaction, following the push contract', () => {
    const result = products.create(newProduct());
    const productId = result.status === 'created' ? result.product.id : '';
    const operations = new SyncOutbox(store, TENANT)
      .pending(100)
      .filter((operation) => operation.type === 'product.created')
      .map(({ attempts: _attempts, ...operation }) => operation);

    expect(operations).toHaveLength(1);
    expect(contractErrorsOfPushRequest({ registerId: registerIdOf(store, TENANT), operations })).toEqual([]);
    expect(operations[0]?.payload).toEqual({
      productId,
      name: 'Cinta métrica 5 m',
      unit: 'piece',
      unitPriceE4: 895_000,
      taxFactor: 'rate',
      taxRateBp: 1600,
      unitCostE6: 52_250_000,
      barcodes: ['7501234567890'],
      isActive: true,
      initialStock: { quantityMilli: 12_000, unitCostE6: 52_250_000 },
      createdBy: owner.id,
      authorizedBy: owner.id,
    });
  });

  it('keeps all of it or none of it: if queueing fails, the product, the codes, the stock and the entry are undone', () => {
    store.transaction((connection) => {
      connection.exec(`CREATE TRIGGER break_outbox BEFORE INSERT ON sync_outbox WHEN NEW.type = 'product.created' BEGIN SELECT RAISE(ABORT, 'outbox is down'); END;`);
    });

    expect(() => products.create(newProduct())).toThrow();

    expect(productCount()).toBe(0);
    expect(count('SELECT count(*) AS total FROM product_barcode')).toBe(0);
    expect(count('SELECT count(*) AS total FROM stock_movement')).toBe(0);
    expect(auditActions()).toEqual([]);
    expect(queuedTypes()).toEqual([]);
  });

  it('keeps all of it or none of it: if the stock cannot be posted, nothing else stays', () => {
    store.transaction((connection) => {
      connection.exec(`CREATE TRIGGER break_ledger BEFORE INSERT ON stock_movement BEGIN SELECT RAISE(ABORT, 'ledger is down'); END;`);
    });

    expect(() => products.create(newProduct())).toThrow();

    expect(productCount()).toBe(0);
    expect(count('SELECT count(*) AS total FROM product_barcode')).toBe(0);
    expect(queuedTypes()).toEqual([]);
  });

  it('can be sold at once: a new sale prices the product and the total adds up', () => {
    const result = products.create(newProduct());
    const productId = result.status === 'created' ? result.product.id : '';
    const quantity = quantityOf(2000, 'piece');
    const total = saleTotals([lineTotals(895_000, quantity, SIXTEEN)]).totalCents;

    const sale = pending.save({ idempotencyKey: uuidV7(), lines: [{ productId, quantityMilli: 2000 }], expectedTotalCents: total });

    expect(sale).toMatchObject({ status: 'saved', sale: { totalCents: 179_00, lines: [{ productName: 'Cinta métrica 5 m', unitPriceE4: 895_000 }] } });
  });

  it('does not sell a product that was added as inactive, or show it in the lookups of the sale', () => {
    const result = products.create(newProduct({ isActive: false }));
    const productId = result.status === 'created' ? result.product.id : '';

    expect(catalog.findById(productId)).toBeNull();
    expect(catalog.findByCode('7501234567890')).toBeNull();
    expect(catalog.search('cinta', 10)).toEqual([]);
    expect(catalog.findById(productId, { includeInactive: true })?.name).toBe('Cinta métrica 5 m');
    expect(pending.save({ idempotencyKey: uuidV7(), lines: [{ productId, quantityMilli: 1000 }], expectedTotalCents: 89_50 })).toEqual({ status: 'catalog_changed' });
  });

  it('leaves the sales already completed exactly as they were', () => {
    const hammerId = uuidV7();
    store.transaction((connection) => {
      connection
        .prepare("INSERT INTO product (id, tenant_id, name, base_unit, unit_price_e4, tax_factor, tax_rate_bp) VALUES (?, ?, 'Martillo', 'piece', 1000000, 'rate', 1600)")
        .run(hammerId, TENANT);
    });
    const quantity = quantityOf(1000, 'piece');
    const line = { id: uuidV7(), productId: hammerId, productName: 'Martillo', quantity, unitPriceE4: 1_000_000, totals: lineTotals(1_000_000, quantity, SIXTEEN) };
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
    ];
    const before = snapshot();

    products.create(newProduct());

    expect(snapshot()).toEqual(before);
  });

  it('creates two products with the same name, because two brands can share one', () => {
    products.create(newProduct({ barcodes: ['111111'] }));

    expect(products.create(newProduct({ barcodes: ['222222'] })).status).toBe('created');
    expect(productCount()).toBe(2);
  });
});

describe('barcodes', () => {
  it('rejects a code another product already has, naming that product, and writes nothing', () => {
    const first = products.create(newProduct());
    const firstId = first.status === 'created' ? first.product.id : '';

    const second = products.create(newProduct({ name: 'Otra cinta', barcodes: ['SIN-USO', '7501234567890'] }));

    expect(second).toEqual({ status: 'duplicate_code', code: '7501234567890', productId: firstId, productName: 'Cinta métrica 5 m' });
    expect(productCount()).toBe(1);
    expect(catalog.findByCode('SIN-USO')).toBeNull();
    expect(auditActions()).toEqual(['product.create']);
    expect(queuedTypes()).toEqual(['product.created']);
  });

  it('keeps the code of a product that was given up taken, so history never points to the wrong product', () => {
    const first = products.create(newProduct({ isActive: false }));
    const firstId = first.status === 'created' ? first.product.id : '';

    const second = products.create(newProduct({ name: 'Otra cinta' }));

    expect(second).toMatchObject({ status: 'duplicate_code', productId: firstId });
  });

  it('ignores spaces around a code that was typed or scanned', () => {
    products.create(newProduct());

    expect(products.create(newProduct({ name: 'Otra', barcodes: ['  7501234567890 '] }))).toMatchObject({ status: 'duplicate_code', code: '7501234567890' });
  });

  it('does not ask a cashier for the PIN before telling about a duplicate code', () => {
    products.create(newProduct());
    asCashier();

    expect(products.create(newProduct({ name: 'Otra' })).status).toBe('duplicate_code');
    expect(auditActions()).toEqual(['product.create']);
  });

  it.each([
    ['repeated in the list', ['111', '111']],
    ['with a space inside', ['111 222']],
    ['empty', ['']],
    ['too long', ['1'.repeat(65)]],
    ['too many', Array.from({ length: 21 }, (_unused, index) => `CODE-${index}`)],
  ])('refuses a list of codes %s', (_name, barcodes) => {
    expect(() => products.create(newProduct({ barcodes }))).toThrow(RangeError);

    expect(productCount()).toBe(0);
  });
});

describe('who may add a product', () => {
  it('lets a cashier add it with the PIN of the owner, recording who asked and who approved', () => {
    asCashier();

    const result = products.create(newProduct({ ownerPin: '4321' }));

    expect(result.status).toBe('created');
    const queued = store.prepare("SELECT payload FROM sync_outbox WHERE type = 'product.created'").get() as unknown as { payload: string };
    expect(JSON.parse(queued.payload)).toMatchObject({ createdBy: cashier.id, authorizedBy: owner.id });
    const entry = store.prepare("SELECT user_id FROM audit_log WHERE action = 'product.create'").get() as unknown as { user_id: string };
    expect(entry.user_id).toBe(cashier.id);
  });

  it('refuses a cashier without a PIN, writes nothing and writes the denial', () => {
    asCashier();

    expect(products.create(newProduct())).toEqual({ status: 'authorization_required' });

    expect(productCount()).toBe(0);
    expect(auditActions()).toEqual(['product.create_denied']);
    expect(queuedTypes()).toEqual([]);
    expect(count('SELECT count(*) AS total FROM stock_movement')).toBe(0);
  });

  it('refuses a wrong PIN with the tries left, and the failed attempt stays in the audit log under the cashier', () => {
    asCashier();

    expect(products.create(newProduct({ ownerPin: '0000' }))).toEqual({ status: 'wrong_pin', attemptsLeft: 4 });

    expect(productCount()).toBe(0);
    const denial = store.prepare("SELECT user_id, detail FROM audit_log WHERE action = 'product.create_denied'").get() as unknown as { user_id: string; detail: string };
    expect(denial.user_id).toBe(cashier.id);
    expect(denial.detail).toContain('wrong_pin');
    expect(denial.detail).toContain('Cinta métrica 5 m');
  });

  it('refuses the PIN of another cashier, because only an owner approves', () => {
    auth.createUser('Beto', 'cashier', '6666');
    asCashier();

    expect(products.create(newProduct({ ownerPin: '6666' })).status).toBe('wrong_pin');

    expect(productCount()).toBe(0);
  });

  it('locks after too many wrong PINs, and the lock is also written down', () => {
    asCashier();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      products.create(newProduct({ ownerPin: '0000' }));
    }

    expect(products.create(newProduct({ ownerPin: '4321' })).status).toBe('locked');

    expect(productCount()).toBe(0);
    expect(auditActions().at(-1)).toBe('product.create_denied');
  });

  it('refuses when nobody is signed in', () => {
    auth.logout();

    expect(() => products.create(newProduct())).toThrow('signed in');
  });
});

describe('what a valid product is', () => {
  it.each([
    ['an empty name', { name: '   ' }],
    ['a name that is too long', { name: 'a'.repeat(201) }],
    ['a price of zero', { unitPriceE4: 0 }],
    ['a negative price', { unitPriceE4: -1 }],
    ['a price with decimals', { unitPriceE4: 1_000.5 }],
    ['a price past the maximum', { unitPriceE4: MAX_UNIT_PRICE_E4 + 1 }],
    ['a VAT rate above 100%', { taxRate: { factor: 'rate' as const, rateBp: 10_001 } }],
    ['an exempt product with a rate', { taxRate: { factor: 'exempt' as const, rateBp: 1600 } }],
    ['a negative cost', { unitCostE6: -1 }],
    ['a cost with decimals', { unitCostE6: 1.5 }],
    ['a negative initial stock', { initialStockMilli: -1_000 }],
    ['an initial stock of zero', { initialStockMilli: 0 }],
    ['a fraction of a piece', { initialStockMilli: 1_500 }],
  ])('refuses %s, and nothing is written', (_name, change) => {
    expect(() => products.create(newProduct(change))).toThrow();

    expect(productCount()).toBe(0);
    expect(auditActions()).toEqual([]);
    expect(queuedTypes()).toEqual([]);
  });

  it('accepts the maximum price, a price with four decimals, an exempt product and a cost of zero', () => {
    expect(products.create(newProduct({ unitPriceE4: MAX_UNIT_PRICE_E4, barcodes: [] })).status).toBe('created');
    expect(products.create(newProduct({ unitPriceE4: 1530, barcodes: [] })).status).toBe('created');
    expect(products.create(newProduct({ taxRate: { factor: 'exempt', rateBp: 0 }, barcodes: [] })).status).toBe('created');
    expect(products.create(newProduct({ unitCostE6: 0, barcodes: [] })).status).toBe('created');
  });

  it('checks the shape of what crosses the bridge', () => {
    const valid = { ...newProduct(), ownerPin: '4321' };

    expect(parseNewProductRequest(valid)).toEqual(valid);
    expect(() => parseNewProductRequest({ ...valid, unit: 'box' })).toThrow(TypeError);
    expect(() => parseNewProductRequest({ ...valid, unitPriceE4: '895000' })).toThrow(TypeError);
    expect(() => parseNewProductRequest({ ...valid, unitPriceE4: 1.5 })).toThrow(TypeError);
    expect(() => parseNewProductRequest({ ...valid, barcodes: 'abc' })).toThrow(TypeError);
    expect(() => parseNewProductRequest({ ...valid, barcodes: [7501234] })).toThrow(TypeError);
    expect(() => parseNewProductRequest({ ...valid, isActive: 'yes' })).toThrow(TypeError);
    expect(() => parseNewProductRequest({ ...valid, ownerPin: '123456789' })).toThrow(TypeError);
    expect(() => parseNewProductRequest({ ...valid, taxRate: { factor: 'other', rateBp: 0 } })).toThrow(TypeError);
    expect(() => parseNewProductRequest(null)).toThrow(TypeError);
  });
});

describe('the revision of a product', () => {
  it('goes up with every change of the product, so a screen can tell that it changed while it was being edited', () => {
    const result = products.create(newProduct());
    const productId = result.status === 'created' ? result.product.id : '';

    store.prepare('UPDATE product SET name = ? WHERE id = ?').run('Cinta de 5 metros', productId);
    store.prepare('UPDATE product SET unit_price_e4 = ? WHERE id = ?').run(900_000, productId);

    expect(reader.detail(productId)?.revision).toBe(3);
  });
});
