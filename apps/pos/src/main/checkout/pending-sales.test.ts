import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MoneyError } from '@pos-saas/money';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PendingSaleRequest } from '../../shared/pos-api';
import { LocalStore } from '../local-store/local-store';
import { ProductCatalog } from '../local-store/product-catalog';
import { SaleStore } from '../local-store/sale-store';
import { uuidV7 } from '../uuid-v7';
import { PendingSales } from './pending-sales';

const TENANT = 'tenant-a';
const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let directory: string;
let store: LocalStore;
let pendingSales: PendingSales;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'pending-sales-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  pendingSales = new PendingSales(new ProductCatalog(store, TENANT), new SaleStore(store, TENANT));
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function addProduct(name: string, unit: string, unitPriceE4: number): string {
  const id = uuidV7();
  store.transaction((connection) => {
    connection
      .prepare(
        `INSERT INTO product (id, tenant_id, name, base_unit, unit_price_e4, tax_factor, tax_rate_bp)
         VALUES (?, ?, ?, ?, ?, 'rate', 1600)`,
      )
      .run(id, TENANT, name, unit, unitPriceE4);
  });
  return id;
}

function requestFor(productId: string, quantityMilli: number, expectedTotalCents: number): PendingSaleRequest {
  return { idempotencyKey: crypto.randomUUID(), lines: [{ productId, quantityMilli }], expectedTotalCents };
}

function rowsIn(table: string): Record<string, unknown>[] {
  return store.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
}

function saveCable(): string {
  const result = pendingSales.save(requestFor(addProduct('Cable THW', 'meter', 125_000), 3275, 4094));
  if (result.status !== 'saved') {
    throw new Error('The sale should have been saved');
  }
  return result.sale.id;
}

describe('save', () => {
  it('saves the sale with the prices and the VAT of the catalog', () => {
    const productId = addProduct('Cable THW', 'meter', 125_000);

    const result = pendingSales.save(requestFor(productId, 3275, 4094));

    expect(result).toMatchObject({
      status: 'saved',
      sale: {
        totalCents: 4094,
        lines: [{ productName: 'Cable THW', quantity: { milli: 3275, unit: 'meter' }, unitPriceE4: 125_000, totalCents: 4094 }],
      },
    });
    expect(rowsIn('sale')).toMatchObject([{ status: 'pending_payment', subtotal_cents: 3529, tax_cents: 565, total_cents: 4094 }]);
    expect(rowsIn('sale_line')).toMatchObject([{ product_id: productId, tax_factor: 'rate', tax_rate_bp: 1600 }]);
  });

  it('adds up several lines', () => {
    const cable = addProduct('Cable THW', 'meter', 125_000);
    const hammer = addProduct('Martillo', 'piece', 1_160_000);

    const result = pendingSales.save({
      idempotencyKey: crypto.randomUUID(),
      lines: [
        { productId: cable, quantityMilli: 3275 },
        { productId: hammer, quantityMilli: 2000 },
      ],
      expectedTotalCents: 27294,
    });

    expect(result).toMatchObject({ status: 'saved', sale: { totalCents: 27294 } });
    expect(rowsIn('sale_line')).toHaveLength(2);
  });

  it('gives the sale and its lines their own UUIDv7', () => {
    saveCable();

    expect(rowsIn('sale')[0]!.id).toMatch(UUID_V7);
    expect(rowsIn('sale_line')[0]!.id).toMatch(UUID_V7);
  });

  it('returns the same sale when the same key arrives twice', () => {
    const request = requestFor(addProduct('Cable THW', 'meter', 125_000), 3275, 4094);

    const first = pendingSales.save(request);
    const second = pendingSales.save(request);

    expect(second).toEqual(first);
    expect(rowsIn('sale')).toHaveLength(1);
    expect(rowsIn('sale_line')).toHaveLength(1);
  });

  it('refuses a key that already belongs to a resolved sale, without creating another sale', () => {
    const request = requestFor(addProduct('Cable THW', 'meter', 125_000), 3275, 4094);
    const saved = pendingSales.save(request);
    pendingSales.cancel(saved.status === 'saved' ? saved.sale.id : '');

    expect(() => pendingSales.save(request)).toThrow(/UNIQUE/);

    expect(rowsIn('sale')).toHaveLength(1);
  });

  it('saves nothing when the catalog gives a total different from the one on the screen', () => {
    const result = pendingSales.save(requestFor(addProduct('Cable THW', 'meter', 125_000), 3275, 4095));

    expect(result).toEqual({ status: 'catalog_changed' });
    expect(rowsIn('sale')).toEqual([]);
  });

  it('saves nothing when a product is no longer in the catalog', () => {
    const result = pendingSales.save(requestFor(uuidV7(), 1000, 100));

    expect(result).toEqual({ status: 'catalog_changed' });
    expect(rowsIn('sale')).toEqual([]);
  });

  it('refuses a fraction of a piece', () => {
    const request = requestFor(addProduct('Martillo', 'piece', 1_160_000), 1500, 17400);

    expect(() => pendingSales.save(request)).toThrow(MoneyError);

    expect(rowsIn('sale')).toEqual([]);
  });
});

describe('list', () => {
  it('shows what is pending, and stops showing it once resolved', () => {
    const saleId = saveCable();
    expect(pendingSales.list().map(({ id }) => id)).toEqual([saleId]);

    pendingSales.cancel(saleId);

    expect(pendingSales.list()).toEqual([]);
  });
});

describe('confirm', () => {
  it('completes the sale with a cash payment for the whole total', () => {
    const saleId = saveCable();

    pendingSales.confirm(saleId);

    expect(rowsIn('sale')).toMatchObject([{ id: saleId, status: 'completed' }]);
    expect(rowsIn('payment')).toMatchObject([{ sale_id: saleId, method: 'cash', amount_cents: 4094 }]);
  });
});

describe('cancel', () => {
  it('keeps the sale, marked as cancelled, with no payment', () => {
    const saleId = saveCable();

    pendingSales.cancel(saleId);

    expect(rowsIn('sale')).toMatchObject([{ id: saleId, status: 'cancelled' }]);
    expect(rowsIn('payment')).toEqual([]);
  });
});
