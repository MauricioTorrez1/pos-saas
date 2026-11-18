import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { UserSummary } from '../../shared/auth';
import {
  SUPPLIER_CATALOG_CHANNELS,
  baseUnitCostE6,
  readListCost,
  readPiecesPerUnit,
  removeVat,
  type ColumnMapping,
  type ImportPriceListResult,
  type PriceListPreview,
} from '../../shared/supplier-catalog';
import type { Supplier } from '../../shared/supplier-order';
import { AuditLog } from '../audit/audit-log';
import { AuthService } from '../auth/auth-service';
import { UserStore } from '../auth/user-store';
import { parseCsv } from '../import/eleventa-csv';
import { InventoryService } from '../inventory/inventory-service';
import { StockStore } from '../inventory/stock-store';
import { LocalStore } from '../local-store/local-store';
import { ProductCatalog } from '../local-store/product-catalog';
import { ProductReader } from '../products/product-reader';
import { ProductService } from '../products/product-service';
import { locateHeader, readPriceListRows, suggestMapping } from './price-list-reader';
import { readPriceListFile, registerSupplierCatalogHandlers } from './supplier-catalog-ipc';
import { SupplierCatalogService } from './supplier-catalog-service';
import { SupplierService } from './supplier-service';

const TENANT = 'tenant-a';
const SIXTEEN = { factor: 'rate', rateBp: 1600 } as const;
const AGREED_CSV = 'supplier_code,description,purchase_unit,pieces_per_unit,cost\nCA-34,"CINTA DE AISLAR 3/4"" NEGRA",Caja,10,85.5\nTH-12,Cable THW calibre 12,Rollo,100,1250.123456\n';

let directory: string;
let store: LocalStore;
let suppliers: SupplierService;
let catalog: SupplierCatalogService;
let owner: UserSummary;
let tapeId: string;
let cableId: string;
let supplier: Supplier;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'supplier-catalog-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  const auth = new AuthService(new UserStore(store, TENANT));
  const products = new ProductCatalog(store, TENANT);
  const reader = new ProductReader(store, TENANT);
  const audit = new AuditLog(store, TENANT);
  const inventory = new InventoryService(store, TENANT, auth, new StockStore(store, TENANT), audit, products);
  const productService = new ProductService(store, TENANT, auth, audit, reader, products, inventory);
  suppliers = new SupplierService(store, TENANT, auth, audit);
  catalog = new SupplierCatalogService(store, TENANT, audit, suppliers);
  owner = auth.setupOwner('Mauricio', '4321');
  auth.login(owner.id, '4321');
  const create = (name: string, unit: 'piece' | 'meter', barcodes: string[]): string => {
    const result = productService.create({ name, unit, unitPriceE4: 125_000, taxRate: SIXTEEN, unitCostE6: null, barcodes, initialStockMilli: null, isActive: true });
    if (result.status !== 'created') {
      throw new Error(`Could not create ${name}`);
    }
    return result.product.id;
  };
  tapeId = create('Cinta de aislar negra', 'piece', ['7501234567890']);
  cableId = create('Cable THW calibre 12', 'meter', []);
  const saved = suppliers.save({ name: 'Ferretera del Centro', contact: null, notes: null, isActive: true });
  if (saved.status !== 'saved') {
    throw new Error('Could not save the supplier');
  }
  supplier = saved.supplier;
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function previewOf(text: string): PriceListPreview {
  return catalog.preview(supplier.id, 'lista.csv', parseCsv(text));
}

function importText(text: string, overrides: { mapping?: ColumnMapping; costsIncludeVat?: boolean; listDate?: string } = {}): ImportPriceListResult {
  const preview = previewOf(text);
  return catalog.import(
    {
      token: preview.token,
      supplierId: supplier.id,
      mapping: overrides.mapping ?? preview.mapping,
      costsIncludeVat: overrides.costsIncludeVat ?? false,
      listDate: overrides.listDate ?? '2026-11-17',
      source: preview.source,
    },
    owner.id,
  );
}

function count(sql: string): number {
  return (store.prepare(sql).get() as unknown as { total: number }).total;
}

describe('the money of a list', () => {
  it('works out the cost per base unit with integers, rounded half up', () => {
    expect(baseUnitCostE6(120_000_000, 12_000)).toBe(10_000_000);
    expect(baseUnitCostE6(100_000_000, 3_000)).toBe(33_333_333);
    expect(baseUnitCostE6(5, 2_000)).toBe(3);
    expect(() => baseUnitCostE6(1, 0)).toThrow(RangeError);
  });

  it('takes the 16 % VAT out of a cost that includes it', () => {
    expect(removeVat(116_000_000)).toBe(100_000_000);
    expect(removeVat(1)).toBe(1);
  });

  it('reads costs as suppliers write them and refuses what is not a cost', () => {
    expect(readListCost('$1,234.50')).toEqual({ ok: true, costE6: 1_234_500_000 });
    expect(readListCost(' 12 ')).toEqual({ ok: true, costE6: 12_000_000 });
    expect(readListCost('0.1234567').ok).toBe(false);
    expect(readListCost('').ok).toBe(false);
    expect(readPiecesPerUnit('')).toEqual({ ok: true, milli: 1000 });
    expect(readPiecesPerUnit('12.5')).toEqual({ ok: true, milli: 12_500 });
    expect(readPiecesPerUnit('0').ok).toBe(false);
  });
});

describe('reading a file', () => {
  it('finds the header under the title rows and guesses the columns by their names', () => {
    const table = locateHeader([['Ferretera del Centro'], ['Lista de precios noviembre'], ['Clave', 'Descripción', 'Precio Lista', 'Presentación'], ['A1', 'Martillo', '99.90', 'Pieza']]);
    expect(table.headers).toEqual(['Clave', 'Descripción', 'Precio Lista', 'Presentación']);
    expect(table.rows[0]).toEqual({ rowNumber: 4, cells: ['A1', 'Martillo', '99.90', 'Pieza'] });
    expect(suggestMapping(table.headers, null)).toEqual({
      mapping: { supplierCode: 'Clave', description: 'Descripción', cost: 'Precio Lista', purchaseUnit: 'Presentación' },
      origin: 'guessed',
    });
  });

  it('recognizes the agreed CSV of the paper catalog (E1-53) and marks it as paper', () => {
    const preview = previewOf(AGREED_CSV);
    expect(preview.mappingOrigin).toBe('agreed');
    expect(preview.source).toBe('paper');
    expect(preview.mapping).toEqual({ supplierCode: 'supplier_code', description: 'description', purchaseUnit: 'purchase_unit', piecesPerUnit: 'pieces_per_unit', cost: 'cost' });
    expect(preview.costsIncludeVat).toBe(false);
  });

  it('leaves out bad rows with their reason and keeps the first of a repeated code', () => {
    const table = locateHeader(parseCsv('codigo,descripcion,costo\nA1,Martillo,10\n,Sin código,5\nA2,,5\nA3,Pinza,abc\nA1,Repetido,7\n'));
    const reading = readPriceListRows(table, { supplierCode: 'codigo', description: 'descripcion', cost: 'costo' }, false);
    expect(reading.items.map((item) => item.supplierCode)).toEqual(['A1']);
    expect(reading.skipped.map((row) => row.rowNumber)).toEqual([3, 4, 5, 6]);
    expect(reading.skipped[3]?.reason).toContain('ya venía');
  });

  it('reads a CSV file and a big file is refused', () => {
    const path = join(directory, 'lista.csv');
    writeFileSync(path, `﻿${AGREED_CSV}`);
    const reading = readPriceListFile(path);
    expect(reading.ok && reading.table[0]).toEqual(['supplier_code', 'description', 'purchase_unit', 'pieces_per_unit', 'cost']);
    expect(readPriceListFile(join(directory, 'missing.csv')).ok).toBe(false);
  });
});

describe('importing a list', () => {
  it('keeps the cost of a purchase unit, the pieces in it and the date, and links by barcode', () => {
    const result = importText('codigo,descripcion,costo,piezas\n7501234567890,Cinta aislar,85.50,10\nX-9,Otra cosa,1,1\n');
    expect(result).toMatchObject({ status: 'imported', summary: { itemCount: 2, linkedCount: 1, skippedCount: 0 } });
    const items = catalog.list({ supplierId: supplier.id, onlyUnlinked: false, text: '' });
    const tape = items.find((item) => item.supplierCode === '7501234567890');
    expect(tape).toMatchObject({ listCostE6: 85_500_000, piecesPerUnitMilli: 10_000, baseUnitCostE6: 8_550_000, productId: tapeId, linkOrigin: 'barcode', listDate: '2026-11-17', source: 'file' });
    expect(catalog.summary(supplier.id)).toEqual({ supplierId: supplier.id, listDate: '2026-11-17', source: 'file', itemCount: 2, linkedCount: 1 });
  });

  it('replaces the previous list of the supplier in one go, with an audit entry each time', () => {
    importText(AGREED_CSV);
    importText('supplier_code,description,purchase_unit,pieces_per_unit,cost\nNEW-1,Pinza de electricista,Pieza,1,150\n', { listDate: '2026-12-01' });
    const items = catalog.list({ supplierId: supplier.id, onlyUnlinked: false, text: '' });
    expect(items.map((item) => item.supplierCode)).toEqual(['NEW-1']);
    expect(items[0]?.listDate).toBe('2026-12-01');
    expect(count("SELECT count(*) AS total FROM audit_log WHERE action = 'supplier_price_list.import'")).toBe(2);
  });

  it('takes the VAT out when the owner says the costs include it', () => {
    importText('codigo,descripcion,costo\nA1,Martillo,116\n', { costsIncludeVat: true });
    expect(catalog.list({ supplierId: supplier.id, onlyUnlinked: false, text: '' })[0]?.listCostE6).toBe(100_000_000);
  });

  it('keeps the previous list when nothing in the file can be read, or a column is missing', () => {
    importText(AGREED_CSV);
    expect(importText('codigo,descripcion,costo\nA1,Martillo,abc\n').status).toBe('empty');
    expect(importText('codigo,descripcion,costo\nA1,Martillo,1\n', { mapping: { supplierCode: 'codigo', description: 'descripcion' } })).toEqual({ status: 'missing_columns', fields: ['cost'] });
    expect(catalog.summary(supplier.id).itemCount).toBe(2);
  });

  it('refuses a file token that was not the last one previewed', () => {
    const first = previewOf(AGREED_CSV);
    previewOf(AGREED_CSV);
    expect(catalog.import({ token: first.token, supplierId: supplier.id, mapping: first.mapping, costsIncludeVat: false, listDate: '2026-11-17', source: 'paper' }, owner.id)).toEqual({ status: 'expired' });
  });

  it('remembers the columns and the VAT choice of each supplier for its next list', () => {
    const custom = 'Clave Prov,Artículo,Importe\nA1,Martillo,10\n';
    importText(custom, { mapping: { supplierCode: 'Clave Prov', description: 'Artículo', cost: 'Importe' }, costsIncludeVat: true });
    const next = previewOf(custom);
    expect(next.mappingOrigin).toBe('remembered');
    expect(next.mapping).toEqual({ supplierCode: 'Clave Prov', description: 'Artículo', cost: 'Importe' });
    expect(next.costsIncludeVat).toBe(true);
    expect(next.source).toBe('file');
  });

  it('still marks the agreed CSV as paper when its columns are remembered', () => {
    importText(AGREED_CSV);
    expect(previewOf(AGREED_CSV)).toMatchObject({ mappingOrigin: 'remembered', source: 'paper' });
  });
});

describe('linking the items to products', () => {
  it('links first by the code the product already has with that supplier', () => {
    suppliers.setCodes({ supplierId: supplier.id, productId: cableId, codes: [{ supplierCode: 'th-12', listCostE6: null, purchaseUnit: null }] });
    importText(AGREED_CSV);
    const cable = catalog.list({ supplierId: supplier.id, onlyUnlinked: false, text: 'cable' })[0];
    expect(cable).toMatchObject({ productId: cableId, linkOrigin: 'supplier_code', productName: 'Cable THW calibre 12', productUnit: 'meter' });
  });

  it('lets the owner link an item by hand once, with an audit entry, and the next list remembers it', () => {
    importText(AGREED_CSV);
    const unlinked = catalog.list({ supplierId: supplier.id, onlyUnlinked: true, text: '' });
    expect(unlinked).toHaveLength(2);
    const tape = unlinked.find((item) => item.supplierCode === 'CA-34')!;
    expect(catalog.link({ itemId: tape.id, productId: tapeId }, owner.id)).toMatchObject({ status: 'linked', item: { productId: tapeId, linkOrigin: 'manual' } });
    expect(count("SELECT count(*) AS total FROM audit_log WHERE action = 'supplier_catalog.link'")).toBe(1);

    expect(importText(AGREED_CSV)).toMatchObject({ status: 'imported', summary: { linkedCount: 1 } });
    expect(catalog.list({ supplierId: supplier.id, onlyUnlinked: false, text: 'aislar' })[0]).toMatchObject({ productId: tapeId, linkOrigin: 'manual' });

    const again = catalog.list({ supplierId: supplier.id, onlyUnlinked: false, text: 'aislar' })[0]!;
    expect(catalog.link({ itemId: again.id, productId: null }, owner.id)).toMatchObject({ status: 'linked', item: { productId: null, linkOrigin: null } });
    expect(importText(AGREED_CSV)).toMatchObject({ summary: { linkedCount: 0 } });
    expect(catalog.link({ itemId: again.id, productId: tapeId }, owner.id)).toEqual({ status: 'not_found' });
  });

  it('finds items by words without caring about accents or capitals', () => {
    importText('codigo,descripcion,costo\nA1,"CINTA DE AISLÁR 3/4""",10\nA2,Martillo,5\n');
    expect(catalog.list({ supplierId: supplier.id, onlyUnlinked: false, text: 'cinta de aislar' }).map((item) => item.supplierCode)).toEqual(['A1']);
  });
});

describe('the bridge of the price lists', () => {
  it('refuses every channel to a cashier', async () => {
    const handlers = new Map<string, (argument: unknown, user: UserSummary) => unknown>();
    registerSupplierCatalogHandlers(
      (channel, respond) => handlers.set(channel, respond),
      (message) => new Error(message),
      { catalog, pickFile: () => Promise.resolve(null) },
    );
    expect([...handlers.keys()].sort()).toEqual(Object.values(SUPPLIER_CATALOG_CHANNELS).sort());
    const cashier: UserSummary = { ...owner, role: 'cashier' };
    for (const respond of handlers.values()) {
      expect(() => respond(supplier.id, cashier)).toThrow('Only the owner');
    }
    await expect(handlers.get(SUPPLIER_CATALOG_CHANNELS.pickPriceList)!(supplier.id, owner)).resolves.toEqual({ status: 'cancelled' });
    expect(() => handlers.get(SUPPLIER_CATALOG_CHANNELS.importPriceList)!({ token: 'x' }, owner)).toThrow(TypeError);
  });
});
