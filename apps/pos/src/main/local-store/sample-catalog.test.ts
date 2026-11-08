import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalStore } from './local-store';
import { ProductCatalog } from './product-catalog';
import { sampleBarcode, seedSampleCatalogIfEmpty } from './sample-catalog';

const TENANT = 'tenant-a';
const UUID_V7_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let directory: string;
let store: LocalStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'sample-catalog-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function countProducts(): number {
  return (store.prepare('SELECT count(*) AS products FROM product').get() as { products: number }).products;
}

describe('seedSampleCatalogIfEmpty', () => {
  it('fills an empty catalog with products marked as samples and ids in UUIDv7', () => {
    seedSampleCatalogIfEmpty(store, TENANT);

    const rows = store.prepare('SELECT id, tenant_id, is_sample FROM product').all() as unknown as {
      id: string;
      tenant_id: string;
      is_sample: number;
    }[];
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.every(({ id }) => UUID_V7_SHAPE.test(id))).toBe(true);
    expect(rows.every(({ tenant_id: tenantId, is_sample: isSample }) => tenantId === TENANT && isSample === 1)).toBe(true);
  });

  it('adds nothing the second time', () => {
    seedSampleCatalogIfEmpty(store, TENANT);
    const productsAfterFirstRun = countProducts();

    seedSampleCatalogIfEmpty(store, TENANT);

    expect(countProducts()).toBe(productsAfterFirstRun);
  });

  it('makes the first sample reachable by its code and by its name', () => {
    seedSampleCatalogIfEmpty(store, TENANT);
    const catalog = new ProductCatalog(store, TENANT);

    expect(catalog.findByCode(sampleBarcode(0))?.name).toBe('Martillo uña curva 16 oz');
    expect(catalog.search('martillo', 5).map(({ name }) => name)).toEqual(['Martillo uña curva 16 oz']);
  });
});

describe('sampleBarcode', () => {
  it('builds a valid EAN-13 code that a scanner accepts', () => {
    // Checked by hand: the digits of 200000000010 weigh 1, 3, 1, 3..., which adds up to 3, so the check digit is 7.
    expect(sampleBarcode(0)).toBe('2000000000107');
    expect(sampleBarcode(1)).toHaveLength(13);
  });
});
