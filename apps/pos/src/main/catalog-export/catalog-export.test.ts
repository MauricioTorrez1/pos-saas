import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { UserSummary } from '../../shared/auth';
import { CATALOG_EXPORT_CHANNELS, type CatalogExportRequest, type CatalogExportResult } from '../../shared/catalog-export';
import { AuditLog } from '../audit/audit-log';
import { AuthService } from '../auth/auth-service';
import { OwnerGate } from '../auth/owner-gate';
import { UserStore } from '../auth/user-store';
import { buildWorkbook } from '../export/xlsx';
import { LocalStore } from '../local-store/local-store';
import { parseCatalogExportRequest, registerCatalogExportHandlers } from './catalog-export-ipc';
import { CatalogExporter, type CatalogExporterDependencies } from './catalog-exporter';
import { CATALOG_LEGEND, catalogCsv, catalogHtml, catalogSheets, csvField, UTF8_BOM, type CatalogHeader } from './catalog-files';
import { CatalogReader } from './catalog-reader';
import { buildCatalogRow, catalogTotals, marginsBp, type CatalogProductRecord, type CatalogRow } from './catalog-rows';

const TENANT = 'tenant-a';
const SIXTEEN = { factor: 'rate', rateBp: 1600 } as const;
const EXEMPT = { factor: 'exempt', rateBp: 0 } as const;
const HEADER: CatalogHeader = { businessName: 'Tlapalería La Esperanza', generatedAt: '18 de noviembre de 2026, 10:00', activeOnly: true };

/** A product of $116.00 with VAT (so $100.00 before VAT) that costs $80.00 before VAT, with 3 pieces on the shelf. */
function record(overrides: Partial<CatalogProductRecord> = {}): CatalogProductRecord {
  return {
    id: 'p1',
    name: 'Martillo uña curva 16 oz',
    unit: 'piece',
    unitPriceE4: 1_160_000,
    taxRate: SIXTEEN,
    isActive: true,
    barcodes: ['0750100000017', '2000000000107'],
    suppliers: [{ supplierName: 'Truper', supplierCode: 'MART-16' }],
    costE6: 80_000_000,
    costSource: 'typed',
    stockMilli: 3_000,
    ...overrides,
  };
}

function sampleRows(): CatalogRow[] {
  return [
    buildCatalogRow(record()),
    buildCatalogRow(
      record({
        id: 'p2',
        name: 'Cable "calibre 12", rojo',
        unit: 'meter',
        unitPriceE4: 185_000,
        barcodes: ['0012345'],
        suppliers: [
          { supplierName: 'Condumex', supplierCode: 'C-12R' },
          { supplierName: 'Viakon', supplierCode: 'V12' },
        ],
        costE6: null,
        costSource: 'none',
        stockMilli: 12_500,
      }),
    ),
    buildCatalogRow(record({ id: 'p3', name: '=HYPERLINK("http://x")', barcodes: [], suppliers: [], costE6: 120_000_000, stockMilli: -2_000, isActive: false })),
  ];
}

describe('the margins of the catalog (ADR 0071)', () => {
  it('works out gross over the price without VAT and net over the price with VAT', () => {
    // $100 before VAT, $80 of cost: 20 % gross; of the $116 the customer pays, $20 stays: 17.24 % net.
    expect(marginsBp(1_160_000, SIXTEEN, 80_000_000)).toEqual({ grossBp: 2000, netBp: 1724 });
  });

  it('gives the same gross and net margin to a product without VAT', () => {
    expect(marginsBp(1_000_000, EXEMPT, 75_000_000)).toEqual({ grossBp: 2500, netBp: 2500 });
  });

  it('shows a product sold below its cost with a negative margin', () => {
    expect(marginsBp(1_160_000, SIXTEEN, 120_000_000)).toEqual({ grossBp: -2000, netBp: -1724 });
  });

  it('rounds once, half away from zero, without rounding the price without VAT on the way', () => {
    // A profit of half a cent on $100 is exactly 0.5 basis points.
    expect(marginsBp(1_160_000, SIXTEEN, 99_995_000)?.grossBp).toBe(1);
    expect(marginsBp(1_160_000, SIXTEEN, 100_005_000)?.grossBp).toBe(-1);
    // $9.99 with VAT is $8.6120689… before VAT. A cost of $5.00 leaves 41.94 %; a base rounded to $8.61 would give 41.93 %.
    expect(marginsBp(99_900, SIXTEEN, 5_000_000)).toEqual({ grossBp: 4194, netBp: 3616 });
  });

  it('has no margin for a price of zero', () => {
    expect(marginsBp(0, SIXTEEN, 1_000_000)).toBeNull();
  });
});

describe('a row of the catalog', () => {
  it('splits the codes, adds the VAT to the cost and values the stock at cost and at price', () => {
    const row = buildCatalogRow(record());
    expect(row.mainBarcode).toBe('0750100000017');
    expect(row.otherBarcodes).toEqual(['2000000000107']);
    expect(row.costWithTaxE6).toBe(92_800_000);
    expect(row.grossMarginBp).toBe(2000);
    expect(row.netMarginBp).toBe(1724);
    expect(row.stockValueAtCostCents).toBe(24_000);
    expect(row.stockValueAtPriceCents).toBe(34_800);
  });

  it('gives a product without a cost no margin and no value at cost, never a made-up one', () => {
    const row = buildCatalogRow(record({ costE6: null, costSource: 'none' }));
    expect(row.costWithTaxE6).toBeNull();
    expect(row.grossMarginBp).toBeNull();
    expect(row.netMarginBp).toBeNull();
    expect(row.stockValueAtCostCents).toBeNull();
    expect(row.stockValueAtPriceCents).toBe(34_800);
  });

  it('keeps the cost of a product without VAT as it is', () => {
    expect(buildCatalogRow(record({ taxRate: EXEMPT })).costWithTaxE6).toBe(80_000_000);
  });

  it('values a stock in meters by rounding half up to the cent, and no stock at zero or below', () => {
    // 12.5 m at $18.50 is $231.25.
    expect(buildCatalogRow(record({ unit: 'meter', unitPriceE4: 185_000, stockMilli: 12_500 })).stockValueAtPriceCents).toBe(23_125);
    const negative = buildCatalogRow(record({ stockMilli: -1_000 }));
    expect(negative.stockValueAtCostCents).toBeNull();
    expect(negative.stockValueAtPriceCents).toBeNull();
  });

  it('adds up the totals, and counts the stock without a cost apart', () => {
    expect(catalogTotals(sampleRows())).toEqual({
      productCount: 3,
      activeCount: 2,
      inactiveCount: 1,
      withoutCostCount: 1,
      stockValueAtCostCents: 24_000,
      stockValueAtPriceCents: 34_800 + 23_125,
      stockedWithoutCostCount: 1,
    });
  });
});

describe('the CSV of the catalog', () => {
  it('starts with the byte order mark so Excel on Windows shows the accents, and ends lines in CRLF', () => {
    const csv = catalogCsv(sampleRows(), catalogTotals(sampleRows()), HEADER);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    expect(Buffer.from(csv, 'utf8').subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(csv).toContain('\r\n');
    expect(csv.replace(/\r\n/g, '')).not.toContain('\n');
    expect(csv.slice(1).split('\r\n')[0]).toBe('Estado,Código principal,Otros códigos,Producto,Unidad,Proveedores (código),Costo sin IVA,Costo con IVA,Precio con IVA,IVA,Existencia,Margen bruto,Margen neto,Origen del costo');
  });

  it('writes one line per product with its numbers, and "sin costo" where there is no cost', () => {
    const lines = catalogCsv(sampleRows(), catalogTotals(sampleRows()), HEADER).split('\r\n');
    expect(lines[1]).toBe('Activo,0750100000017,2000000000107,Martillo uña curva 16 oz,Pieza,Truper (MART-16),80.00,92.80,116.00,16 %,3.000,20.00 %,17.24 %,Capturado');
    expect(lines[2]).toBe('Activo,0012345,,"Cable ""calibre 12"", rojo",Metro,Condumex (C-12R); Viakon (V12),sin costo,sin costo,18.50,16 %,12.500,sin costo,sin costo,Sin costo');
  });

  it('quotes commas, quotes and line breaks, and disarms a text that Excel would run as a formula', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('dice "hola"')).toBe('"dice ""hola"""');
    expect(csvField('dos\nlíneas')).toBe('"dos\nlíneas"');
    expect(csvField('=1+1')).toBe("'=1+1");
    expect(csvField('+52 55')).toBe("'+52 55");
    expect(csvField('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvField('-12.50', false)).toBe('-12.50');
    const line = catalogCsv(sampleRows(), catalogTotals(sampleRows()), HEADER).split('\r\n')[3];
    expect(line).toContain(`"'=HYPERLINK(""http://x"")"`);
    // The negative margin is a number the export wrote, so it keeps its minus sign.
    expect(line).toContain(',-20.00 %,-17.24 %,');
    expect(line?.startsWith('Dado de baja,')).toBe(true);
  });

  it('ends with the totals and the legend', () => {
    const csv = catalogCsv(sampleRows(), catalogTotals(sampleRows()), HEADER);
    expect(csv).toContain('Productos,3\r\n');
    expect(csv).toContain('Valor del inventario a costo (sin IVA),240.00\r\n');
    expect(csv).toContain('Valor del inventario a precio (con IVA),579.25\r\n');
    expect(csv).toContain('Leyenda');
    expect(csv).toContain('Margen neto = (precio sin IVA − costo sin IVA) ÷ precio con IVA');
  });
});

describe('the Excel workbook of the catalog', () => {
  async function readBack(rows: CatalogRow[]): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    // The typings of exceljs ask for their own Buffer interface, which Node's Buffer satisfies.
    await workbook.xlsx.load(buildWorkbook(catalogSheets(rows, catalogTotals(rows), HEADER)) as unknown as ExcelJS.Buffer);
    return workbook;
  }

  it('has the header row frozen, codes as texts and money, stock and margins as numbers', async () => {
    const workbook = await readBack(sampleRows());
    const sheet = workbook.getWorksheet('Catálogo');
    expect(sheet).toBeDefined();
    expect(sheet?.views[0]).toMatchObject({ state: 'frozen', ySplit: 4 });
    expect(sheet?.getRow(4).getCell(1).value).toBe('Estado');
    const hammer = sheet?.getRow(5);
    expect(hammer?.getCell(2).value).toBe('0750100000017');
    expect(hammer?.getCell(6).value).toBe('Truper (MART-16)');
    expect(hammer?.getCell(7).value).toBe(80);
    expect(hammer?.getCell(8).value).toBe(92.8);
    expect(hammer?.getCell(9).value).toBe(116);
    expect(hammer?.getCell(11).value).toBe(3);
    expect(hammer?.getCell(12).value).toBe(20);
    expect(hammer?.getCell(13).value).toBe(17.24);
    const cable = sheet?.getRow(6);
    expect(cable?.getCell(2).value).toBe('0012345');
    expect(cable?.getCell(7).value).toBe('sin costo');
    expect(cable?.getCell(12).value).toBe('sin costo');
    // A name that looks like a formula is a text, never a formula.
    expect(sheet?.getRow(7).getCell(4).value).toBe('=HYPERLINK("http://x")');
  });

  it('ends with the totals and has the legend in a sheet of its own', async () => {
    const workbook = await readBack(sampleRows());
    const sheet = workbook.getWorksheet('Catálogo');
    const values: unknown[] = [];
    sheet?.eachRow((row) => values.push(row.getCell(1).value, row.getCell(2).value));
    expect(values).toContain('Totales');
    expect(values).toContain(240);
    expect(values).toContain(579.25);
    const legend = workbook.getWorksheet('Leyenda');
    expect(legend?.getRow(2).getCell(1).value).toBe(CATALOG_LEGEND[0]);
  });
});

describe('the PDF page of the catalog', () => {
  it('escapes every text, blocks scripts and the network, and repeats its header row on letter landscape', () => {
    const rows = [buildCatalogRow(record({ name: '<script>alert(1)</script> & "llave"' }))];
    const html = catalogHtml(rows, catalogTotals(rows), { ...HEADER, businessName: 'Tlapalería <b>' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;llave&quot;');
    expect(html).toContain('Tlapalería &lt;b&gt;');
    expect(html).toContain(`content="default-src 'none'; style-src 'unsafe-inline'"`);
    expect(html).toContain('size: letter landscape');
    expect(html).toContain('<thead><tr><th scope="col">Estado</th>');
    expect(html).toContain('thead { display: table-header-group; }');
  });

  it('ends with the totals and the legend', () => {
    const rows = sampleRows();
    const html = catalogHtml(rows, catalogTotals(rows), HEADER);
    expect(html).toContain('<td>Valor del inventario a costo (sin IVA)</td><td class="number">$240.00</td>');
    expect(html).toContain('<td>Productos</td><td class="number">3</td>');
    expect(html).toContain('Leyenda');
    expect(html).toContain('<tr class="inactive">');
  });
});

describe('the catalog read from the register', () => {
  let directory: string;
  let store: LocalStore;

  const insertProduct = (id: string, name: string, overrides: { cost?: number | null; active?: boolean; unit?: string; tax?: 'rate' | 'exempt' } = {}): void => {
    store
      .prepare('INSERT INTO product (id, tenant_id, name, base_unit, unit_price_e4, tax_factor, tax_rate_bp, is_active, unit_cost_e6) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, TENANT, name, overrides.unit ?? 'piece', 1_160_000, overrides.tax ?? 'rate', overrides.tax === 'exempt' ? 0 : 1600, overrides.active === false ? 0 : 1, overrides.cost ?? null);
  };
  let movement = 0;
  const move = (productId: string, quantityMilli: number, unitCostE6: number | null = null): void => {
    movement += 1;
    store
      .prepare('INSERT INTO stock_movement (id, tenant_id, product_id, type, quantity_milli, unit_cost_e6, source, source_id, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(`m${movement}`, TENANT, productId, quantityMilli > 0 ? 'opening_balance' : 'sale', quantityMilli, unitCostE6, 'test', `s${movement}`, '2026-11-18T10:00:00.000Z');
  };

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'catalog-export-'));
    store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
    insertProduct('hammer', 'Martillo', { cost: 80_000_000 });
    insertProduct('cable', 'Cable', { unit: 'meter' });
    insertProduct('old', 'Brocha vieja', { active: false });
    store.prepare('INSERT INTO product_barcode (tenant_id, code, product_id) VALUES (?, ?, ?)').run(TENANT, '200', 'hammer');
    store.prepare('INSERT INTO product_barcode (tenant_id, code, product_id) VALUES (?, ?, ?)').run(TENANT, '100', 'hammer');
    for (const [id, name] of [
      ['truper', 'Truper'],
      ['urrea', 'Urrea'],
    ] as const) {
      store
        .prepare('INSERT INTO supplier (id, tenant_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(id, TENANT, name, '2026-11-18T10:00:00.000Z', '2026-11-18T10:00:00.000Z');
    }
    store.prepare('INSERT INTO supplier_product_code (tenant_id, supplier_id, product_id, supplier_code) VALUES (?, ?, ?, ?)').run(TENANT, 'urrea', 'hammer', 'U-7');
    store.prepare('INSERT INTO supplier_product_code (tenant_id, supplier_id, product_id, supplier_code) VALUES (?, ?, ?, ?)').run(TENANT, 'truper', 'hammer', 'T-16');
    // The cable has no typed cost: 10 m at $10, 5 m sold, then 5 m at $16 make an average of $13.
    move('cable', 10_000, 10_000_000);
    move('cable', -5_000);
    move('cable', 5_000, 16_000_000);
    move('hammer', 4_000);
    move('hammer', -1_000);
  });

  afterEach(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('reads every product with its codes, suppliers, stock from the ledger and cost', () => {
    const products = new CatalogReader(store, TENANT).read(false);
    expect(products.map((product) => product.name)).toEqual(['Brocha vieja', 'Cable', 'Martillo']);
    const hammer = products.find((product) => product.id === 'hammer');
    expect(hammer).toMatchObject({
      barcodes: ['100', '200'],
      suppliers: [
        { supplierName: 'Truper', supplierCode: 'T-16' },
        { supplierName: 'Urrea', supplierCode: 'U-7' },
      ],
      costE6: 80_000_000,
      costSource: 'typed',
      stockMilli: 3_000,
      isActive: true,
    });
    expect(products.find((product) => product.id === 'cable')).toMatchObject({ costE6: 13_000_000, costSource: 'average', stockMilli: 10_000, unit: 'meter' });
    expect(products.find((product) => product.id === 'old')).toMatchObject({ costE6: null, costSource: 'none', stockMilli: 0, isActive: false, barcodes: [], suppliers: [] });
  });

  it('leaves out the products that were given up when asked for the active ones only', () => {
    expect(new CatalogReader(store, TENANT).read(true).map((product) => product.id)).toEqual(['cable', 'hammer']);
  });
});

describe('exporting the catalog', () => {
  let directory: string;
  let store: LocalStore;
  let auth: AuthService;
  let owner: UserSummary;
  let cashier: UserSummary;
  let written: Map<string, Buffer>;
  let savePath: string | null;

  const exporter = (overrides: Partial<CatalogExporterDependencies> = {}): CatalogExporter =>
    new CatalogExporter({
      reader: { read: (activeOnly) => [record(), record({ id: 'p2', name: 'Brocha', isActive: false })].filter((product) => !activeOnly || product.isActive) },
      gate: new OwnerGate(auth, new AuditLog(store, TENANT)),
      audit: new AuditLog(store, TENANT),
      pickSavePath: () => Promise.resolve(savePath),
      renderPdf: (html) => Promise.resolve(Buffer.from(`%PDF-${html.length}`)),
      businessName: () => 'Tlapalería La Esperanza',
      writeFile: (path, bytes) => written.set(path, bytes),
      now: () => new Date(2026, 10, 18, 10, 0),
      ...overrides,
    });

  const auditActions = (): { action: string; user_id: string; detail: string }[] =>
    store.prepare("SELECT action, user_id, detail FROM audit_log WHERE entity = 'catalog' ORDER BY rowid").all() as unknown as { action: string; user_id: string; detail: string }[];

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'catalog-exporter-'));
    store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
    auth = new AuthService(new UserStore(store, TENANT));
    owner = auth.setupOwner('Mauricio', '4321');
    auth.login(owner.id, '4321');
    cashier = auth.createUser('Ana', 'cashier', '5555');
    written = new Map();
    savePath = 'C:\\catalogo.csv';
  });

  afterEach(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('saves the file of the owner and writes it in the audit log', async () => {
    const result = await exporter().export({ format: 'csv', activeOnly: true }, owner);
    expect(result).toEqual({ status: 'saved', path: 'C:\\catalogo.csv', productCount: 1 });
    expect(written.get('C:\\catalogo.csv')?.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(auditActions()).toEqual([{ action: 'catalog.export', user_id: owner.id, detail: expect.stringContaining('1 productos (solo activos) en CSV') as string }]);
  });

  it('includes the products that were given up when the filter is off', async () => {
    const result = await exporter().export({ format: 'xlsx', activeOnly: false }, owner);
    expect(result).toMatchObject({ status: 'saved', productCount: 2 });
    expect(written.get('C:\\catalogo.csv')?.subarray(0, 2).toString()).toBe('PK');
  });

  it('prints the PDF through the printer it was given', async () => {
    const result = await exporter().export({ format: 'pdf', activeOnly: true }, owner);
    expect(result.status).toBe('saved');
    expect(written.get('C:\\catalogo.csv')?.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('refuses a cashier without the PIN of an owner, asks for no file and writes the refusal down', async () => {
    let asked = false;
    const result = await exporter({ pickSavePath: () => ((asked = true), Promise.resolve(savePath)) }).export({ format: 'csv', activeOnly: true }, cashier);
    expect(result).toEqual({ status: 'authorization_required' });
    expect(asked).toBe(false);
    expect(written.size).toBe(0);
    expect(auditActions()).toEqual([{ action: 'catalog.export_denied', user_id: cashier.id, detail: expect.stringContaining('authorization_required') as string }]);
  });

  it('refuses a wrong PIN and lets a cashier through with the right one', async () => {
    expect(await exporter().export({ format: 'csv', activeOnly: true, ownerPin: '0000' }, cashier)).toMatchObject({ status: 'wrong_pin' });
    expect(await exporter().export({ format: 'csv', activeOnly: true, ownerPin: '4321' }, cashier)).toMatchObject({ status: 'saved' });
    expect(auditActions().map((entry) => entry.action)).toEqual(['catalog.export_denied', 'catalog.export']);
    expect(auditActions()[1]?.detail).toContain(`aprobado por ${owner.id}`);
  });

  it('writes nothing when the person closes the window to save', async () => {
    savePath = null;
    expect(await exporter().export({ format: 'csv', activeOnly: true }, owner)).toEqual({ status: 'cancelled' });
    expect(written.size).toBe(0);
    expect(auditActions()).toEqual([]);
  });

  it('answers in words when the file cannot be written', async () => {
    const result = await exporter({ writeFile: () => { throw new Error('EBUSY'); } }).export({ format: 'csv', activeOnly: true }, owner);
    expect(result).toMatchObject({ status: 'failed' });
  });

  it('exports 5,000 products quickly and lets the register answer while it works', async () => {
    const many = Array.from({ length: 5_000 }, (_, index) => record({ id: `p${index}`, name: `Producto ${index}`, barcodes: [String(7_500_000 + index)] }));
    let turns = 0;
    const ticker = setInterval(() => (turns += 1), 0);
    const started = performance.now();
    try {
      for (const format of ['csv', 'xlsx', 'pdf'] as const) {
        expect(await exporter({ reader: { read: () => many } }).export({ format, activeOnly: true }, owner)).toMatchObject({ status: 'saved', productCount: 5_000 });
      }
    } finally {
      clearInterval(ticker);
    }
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(turns).toBeGreaterThan(0);
  });
});

describe('the channel to export the catalog', () => {
  it('reads only a whole request', () => {
    expect(parseCatalogExportRequest({ format: 'pdf', activeOnly: true })).toEqual({ format: 'pdf', activeOnly: true });
    expect(parseCatalogExportRequest({ format: 'csv', activeOnly: false, ownerPin: '1234' })).toEqual({ format: 'csv', activeOnly: false, ownerPin: '1234' });
    expect(() => parseCatalogExportRequest({ format: 'docx', activeOnly: true })).toThrow(TypeError);
    expect(() => parseCatalogExportRequest({ format: 'csv' })).toThrow(TypeError);
    expect(() => parseCatalogExportRequest({ format: 'csv', activeOnly: true, ownerPin: 1234 })).toThrow(TypeError);
    expect(() => parseCatalogExportRequest(null)).toThrow(TypeError);
  });

  it('hands the request and the person signed in to the exporter, which refuses a cashier', async () => {
    const handlers = new Map<string, (argument: unknown, user: UserSummary) => unknown>();
    const seen: [CatalogExportRequest, string][] = [];
    registerCatalogExportHandlers(
      (channel, respond) => handlers.set(channel, respond),
      {
        export: (request, user) => {
          seen.push([request, user.id]);
          return Promise.resolve<CatalogExportResult>(user.role === 'owner' ? { status: 'cancelled' } : { status: 'authorization_required' });
        },
      },
    );
    const handler = handlers.get(CATALOG_EXPORT_CHANNELS.exportCatalog);
    expect(handler).toBeDefined();
    const cashier: UserSummary = { id: 'u2', name: 'Ana', role: 'cashier' };
    expect(await handler?.({ format: 'xlsx', activeOnly: true }, cashier)).toEqual({ status: 'authorization_required' });
    expect(seen).toEqual([[{ format: 'xlsx', activeOnly: true }, 'u2']]);
    expect(() => handler?.({ format: 'exe', activeOnly: true }, cashier)).toThrow(TypeError);
  });
});
