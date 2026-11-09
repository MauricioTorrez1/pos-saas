import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StockStore } from '../inventory/stock-store';
import { LocalStore } from '../local-store/local-store';
import { ProductCatalog } from '../local-store/product-catalog';
import { seedSampleCatalogIfEmpty } from '../local-store/sample-catalog';
import { CatalogImporter } from './catalog-importer';
import { parseEleventaCatalog } from './eleventa-csv';

const TENANT = 'tenant-a';
const HEADER = 'Código,Descripción,Precio Costo,Precio Venta,Existencia,Unidad';
const FILE = `${HEADER}\n7501,Martillo uña curva,80,116,12,Pieza\n7502,Cable THW,6.25,12.5,100,m\n7503,Clavo,20,45,0,Kg`;

let directory: string;
let store: LocalStore;
let importer: CatalogImporter;
let catalog: ProductCatalog;
let stock: StockStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'import-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  stock = new StockStore(store, TENANT);
  importer = new CatalogImporter(store, TENANT, stock);
  catalog = new ProductCatalog(store, TENANT);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function load(text: string) {
  const reading = parseEleventaCatalog(text);
  if (reading.status !== 'read') {
    throw new Error(reading.message);
  }
  return importer.load(reading);
}

describe('loading the catalog of Eleventa (RF-034)', () => {
  it('creates each product with its barcode, so it can be scanned and searched', () => {
    const report = load(FILE);

    expect(report).toMatchObject({ rowsRead: 3, created: 3, alreadyThere: 0, invalid: [] });
    expect(catalog.findByCode('7501')).toMatchObject({ name: 'Martillo uña curva', unit: 'piece', unitPriceE4: 1_160_000, taxRate: { factor: 'rate', rateBp: 1600 } });
    expect(catalog.findByCode('7502')).toMatchObject({ unit: 'meter', unitPriceE4: 125_000 });
    expect(catalog.search('martillo', 5).map(({ name }) => name)).toEqual(['Martillo uña curva']);
  });

  it('posts the stock as opening balances from the import, and none for a product with no stock', () => {
    const report = load(FILE);

    expect(report.openingBalances).toBe(2);
    expect(stock.levelOf(catalog.findByCode('7501')!.id)).toBe(12_000);
    expect(stock.levelOf(catalog.findByCode('7502')!.id)).toBe(100_000);
    expect(stock.levelOf(catalog.findByCode('7503')!.id)).toBe(0);
    expect(store.prepare("SELECT DISTINCT type, source FROM stock_movement").all()).toEqual([{ type: 'opening_balance', source: 'import' }]);
  });

  it('does not duplicate anything when the same file is loaded again', () => {
    load(FILE);

    const second = load(FILE);

    expect(second).toMatchObject({ created: 0, alreadyThere: 3, openingBalances: 0 });
    expect(store.prepare('SELECT count(*) AS total FROM product WHERE is_sample = 0').get()).toEqual({ total: 3 });
    expect(stock.levelOf(catalog.findByCode('7501')!.id)).toBe(12_000);
  });

  it('adds only the new products when a bigger file is loaded later', () => {
    load(FILE);

    const second = load(`${FILE}\n7504,Pala,150,230,4,Pieza`);

    expect(second).toMatchObject({ created: 1, alreadyThere: 3, openingBalances: 1 });
  });

  it('keeps the price a person already changed in the register, because the file is only the starting point', () => {
    load(FILE);
    store.transaction((connection) => {
      connection.exec("UPDATE product SET unit_price_e4 = 999000 WHERE name = 'Cable THW'");
    });

    load(FILE);

    expect(catalog.findByCode('7502')!.unitPriceE4).toBe(999_000);
  });

  it('reports the value of the stock it loaded, to compare with the inventory report of Eleventa', () => {
    const report = load(FILE);

    // 12 hammers at $80.00 and 100 m of cable at $6.25.
    expect(report.inventoryValueCents).toBe(96_000 + 62_500);
  });

  it('reports the rows it left out, and still loads the rest', () => {
    const report = load(`${FILE}\n,Sin código,1,2,3,Pieza\n7505,Mal precio,1,abc,3,Pieza`);

    expect(report).toMatchObject({ rowsRead: 5, created: 3, invalid: [{ line: 5 }, { line: 6 }] });
  });

  it('removes the sample products once the real catalog is in, so nobody sells a hammer that does not exist', () => {
    seedSampleCatalogIfEmpty(store, TENANT);
    expect(catalog.findByCode('2000000000107')).not.toBeNull();

    const report = load(FILE);

    expect(report.samplesRemoved).toBeGreaterThan(0);
    expect(catalog.findByCode('2000000000107')).toBeNull();
    expect(catalog.findByCode('7501')).not.toBeNull();
  });

  it('keeps the sample products when the file had nothing to load', () => {
    seedSampleCatalogIfEmpty(store, TENANT);

    const report = importer.load({ rows: [], invalid: [] });

    expect(report.samplesRemoved).toBe(0);
    expect(catalog.findByCode('2000000000107')).not.toBeNull();
  });

  it('loads all or nothing for each product: a failure leaves no half product', () => {
    store.transaction((connection) => {
      connection.exec(`CREATE TRIGGER fail_on_stock BEFORE INSERT ON stock_movement BEGIN SELECT RAISE(ABORT, 'disk full'); END;`);
    });

    expect(() => load(FILE)).toThrow('disk full');

    expect(store.prepare('SELECT count(*) AS total FROM product').get()).toEqual({ total: 0 });
  });
});
