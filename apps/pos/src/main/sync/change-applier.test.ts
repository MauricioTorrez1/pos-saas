import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalStore } from '../local-store/local-store';
import { ProductCatalog } from '../local-store/product-catalog';
import { ChangeApplier } from './change-applier';
import { parsePullResponse, type ProductState, type PullChange, type PullPage } from './pull-protocol';
import { SyncProtocolError } from './sync-protocol';

const TENANT = 'tenant-a';
const CABLE = '0193a5c0-0000-7000-8000-000000000050';
const BOLT = '0193a5c0-0000-7000-8000-000000000051';
const STAFF = '0193a5c0-0000-7000-8000-000000000040';

const CABLE_STATE: ProductState = {
  name: 'Cable THW calibre 12',
  baseUnit: 'meter',
  unitPriceE4: 386_667,
  taxFactor: 'rate',
  taxRateBp: 1600,
  barcodes: ['CBL-12-NEG'],
};

let directory: string;
let store: LocalStore;
let applier: ChangeApplier;
let catalog: ProductCatalog;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'change-applier-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  applier = new ChangeApplier(store, TENANT);
  catalog = new ProductCatalog(store, TENANT);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function upsert(seq: number, id: string, payload: ProductState): PullChange {
  return { seq, entityType: 'product', entityId: id, deleted: false, payload };
}

function page(changes: PullChange[], hasMore = false, nextCursor = String(changes.at(-1)?.seq ?? 0)): PullPage {
  return { changes, nextCursor, hasMore };
}

function rowCount(table: string): number {
  return (store.prepare(`SELECT count(*) AS total FROM ${table}`).get() as { total: number }).total;
}

describe('applying a page', () => {
  it('starts at cursor 0 and moves it with the changes it writes', () => {
    expect(applier.currentCursor()).toBe('0');

    const outcome = applier.apply(page([upsert(1, CABLE, CABLE_STATE), upsert(2, BOLT, { ...CABLE_STATE, name: 'Tornillo', barcodes: [] })]));

    expect(outcome).toMatchObject({ productsSaved: 2, productsRemoved: 0, cursor: '2' });
    expect(applier.currentCursor()).toBe('2');
    expect(catalog.findById(CABLE)).toMatchObject({ name: 'Cable THW calibre 12', unitPriceE4: 386_667 });
    expect(catalog.findByCode('CBL-12-NEG')?.id).toBe(CABLE);
    expect(catalog.search('tornillo', 10)).toHaveLength(1);
  });

  it('applies a price change over the product that was already there', () => {
    applier.apply(page([upsert(1, CABLE, CABLE_STATE)]));

    applier.apply(page([upsert(2, CABLE, { ...CABLE_STATE, unitPriceE4: 400_000 })]));

    expect(catalog.findById(CABLE)?.unitPriceE4).toBe(400_000);
    expect(rowCount('product')).toBe(1);
  });

  it('replaces the barcodes with the ones of the new state, and a code that moves follows the newest product', () => {
    applier.apply(page([upsert(1, CABLE, CABLE_STATE), upsert(2, BOLT, { ...CABLE_STATE, name: 'Tornillo', barcodes: ['TOR-1'] })]));

    applier.apply(page([upsert(3, CABLE, { ...CABLE_STATE, barcodes: ['CBL-NEW'] }), upsert(4, BOLT, { ...CABLE_STATE, name: 'Tornillo', barcodes: ['TOR-1', 'CBL-12-NEG'] })]));

    expect(catalog.findByCode('CBL-NEW')?.id).toBe(CABLE);
    expect(catalog.findByCode('CBL-12-NEG')?.id).toBe(BOLT);
    expect(rowCount('product_barcode')).toBe(3);
  });

  it('removes a deleted product with its barcodes and its place in the search', () => {
    applier.apply(page([upsert(1, CABLE, CABLE_STATE)]));

    const outcome = applier.apply(page([{ seq: 2, entityType: 'product', entityId: CABLE, deleted: true }]));

    expect(outcome.productsRemoved).toBe(1);
    expect(catalog.findById(CABLE)).toBeNull();
    expect(catalog.findByCode('CBL-12-NEG')).toBeNull();
    expect(catalog.search('cable', 10)).toEqual([]);
    expect(rowCount('product_barcode')).toBe(0);
  });

  it('accepts the deletion of a product it never had, because a register may start after the product was created and removed', () => {
    const outcome = applier.apply(page([{ seq: 7, entityType: 'product', entityId: CABLE, deleted: true }]));

    expect(outcome).toMatchObject({ productsRemoved: 0, cursor: '7' });
  });

  it('stores the permissions of a staff member and replaces them when they change', () => {
    const member = (permissions: string[]): PullChange => ({
      seq: 1,
      entityType: 'staff_member',
      entityId: STAFF,
      deleted: false,
      payload: { displayName: 'Cajero', role: 'cashier', permissions, active: true },
    });

    applier.apply(page([member(['product.read'])]));
    applier.apply({ changes: [{ ...member(['product.read', 'sync.push']), seq: 2 }], nextCursor: '2', hasMore: false });

    const row = store.prepare('SELECT permissions, is_active FROM staff_permission WHERE id = ?').get(STAFF) as { permissions: string; is_active: number };
    expect(JSON.parse(row.permissions)).toEqual(['product.read', 'sync.push']);
    expect(row.is_active).toBe(1);
  });

  it('turns a sample product into a real one when the core sends it', () => {
    store.prepare(`INSERT INTO product (id, tenant_id, name, base_unit, unit_price_e4, tax_factor, tax_rate_bp, is_sample) VALUES (?, ?, 'Muestra', 'piece', 100, 'rate', 1600, 1)`).run(CABLE, TENANT);

    applier.apply(page([upsert(1, CABLE, CABLE_STATE)]));

    expect(store.prepare('SELECT is_sample FROM product WHERE id = ?').get(CABLE)).toEqual({ is_sample: 0 });
  });
});

describe('the cursor and the changes are saved together', () => {
  it('keeps nothing of a page whose third change cannot be written, and does not move the cursor', () => {
    applier.apply(page([upsert(1, CABLE, CABLE_STATE)]));
    const broken = upsert(4, '0193a5c0-0000-7000-8000-000000000052', { ...CABLE_STATE, name: 'Roto', unitPriceE4: -5, barcodes: [] });

    expect(() => applier.apply(page([upsert(2, BOLT, { ...CABLE_STATE, name: 'Tornillo', barcodes: [] }), upsert(3, CABLE, { ...CABLE_STATE, unitPriceE4: 1 }), broken]))).toThrow();

    expect(applier.currentCursor()).toBe('1');
    expect(catalog.findById(BOLT)).toBeNull();
    expect(catalog.findById(CABLE)?.unitPriceE4).toBe(386_667);
    expect(rowCount('product')).toBe(1);
  });

  it('undoes the changes of the page when the cursor itself cannot be written, the last step before the commit', () => {
    applier.apply(page([upsert(1, CABLE, CABLE_STATE)]));
    store.transaction((connection) => {
      connection.exec(`CREATE TRIGGER fail_cursor BEFORE UPDATE ON sync_pull_state BEGIN SELECT RAISE(ABORT, 'disk full'); END`);
    });

    expect(() => applier.apply(page([upsert(2, CABLE, { ...CABLE_STATE, unitPriceE4: 999 }), upsert(3, BOLT, { ...CABLE_STATE, name: 'Tornillo', barcodes: [] })]))).toThrow('disk full');

    expect(applier.currentCursor()).toBe('1');
    expect(catalog.findById(CABLE)?.unitPriceE4).toBe(386_667);
    expect(catalog.findById(BOLT)).toBeNull();
  });

  it('refuses a page that would move the cursor back, so a core that was restored is noticed', () => {
    applier.apply(page([upsert(5, CABLE, CABLE_STATE)]));

    expect(() => applier.apply(page([upsert(2, BOLT, CABLE_STATE)]))).toThrow(SyncProtocolError);

    expect(applier.currentCursor()).toBe('5');
    expect(catalog.findById(BOLT)).toBeNull();
  });

  it('moves the cursor over an empty page without touching the data', () => {
    applier.apply(page([upsert(1, CABLE, CABLE_STATE)]));

    applier.apply({ changes: [], nextCursor: '1', hasMore: false });

    expect(applier.currentCursor()).toBe('1');
    expect(rowCount('product')).toBe(1);
  });
});

describe('applying the same thing again', () => {
  it('leaves exactly the same data when a page is applied twice, which is what a lost acknowledgement causes', () => {
    const first = page([upsert(1, CABLE, CABLE_STATE), upsert(2, BOLT, { ...CABLE_STATE, name: 'Tornillo', barcodes: ['TOR-1'] }), { seq: 3, entityType: 'product', entityId: BOLT, deleted: true }]);
    applier.apply(first);
    const snapshot = [rowCount('product'), rowCount('product_barcode'), catalog.findById(CABLE), applier.currentCursor()];

    applier.apply(first);

    expect([rowCount('product'), rowCount('product_barcode'), catalog.findById(CABLE), applier.currentCursor()]).toEqual(snapshot);
  });

  it('starts over from 0 after a reset and ends with the same catalog', () => {
    applier.apply(page([upsert(1, CABLE, CABLE_STATE)]));

    applier.resetCursor();
    expect(applier.currentCursor()).toBe('0');
    applier.apply(page([upsert(1, CABLE, CABLE_STATE)]));

    expect(rowCount('product')).toBe(1);
    expect(applier.currentCursor()).toBe('1');
  });
});

describe('a page that is not the contract', () => {
  it.each([
    ['an unknown kind of entity', { changes: [{ seq: 1, entityType: 'loyalty_card', entityId: CABLE, deleted: true, schemaVersion: 1, changedAt: '2026-12-10T18:21:04.123Z' }], nextCursor: '1', hasMore: false }],
    ['a price with decimals', { changes: [{ seq: 1, entityType: 'product', entityId: CABLE, deleted: false, schemaVersion: 1, changedAt: 'x', payload: { ...CABLE_STATE, unitPriceE4: 1.5 } }], nextCursor: '1', hasMore: false }],
    ['changes out of order', { changes: [{ seq: 2, entityType: 'product', entityId: CABLE, deleted: true, schemaVersion: 1, changedAt: 'x' }, { seq: 1, entityType: 'product', entityId: BOLT, deleted: true, schemaVersion: 1, changedAt: 'x' }], nextCursor: '1', hasMore: false }],
    ['a cursor that is not the last change', { changes: [{ seq: 1, entityType: 'product', entityId: CABLE, deleted: true, schemaVersion: 1, changedAt: 'x' }], nextCursor: '9', hasMore: false }],
    ['a deletion with a payload', { changes: [{ seq: 1, entityType: 'product', entityId: CABLE, deleted: true, schemaVersion: 1, changedAt: 'x', payload: CABLE_STATE }], nextCursor: '1', hasMore: false }],
  ])('is refused before anything is applied: %s', (_name, body) => {
    expect(() => parsePullResponse(body)).toThrow(SyncProtocolError);
  });
});
