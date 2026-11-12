import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import ExcelJS from 'exceljs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { OrderFileFormat, PurchaseOrder } from '../../shared/supplier-order';
import { AuditLog } from '../audit/audit-log';
import { AuthService } from '../auth/auth-service';
import { UserStore } from '../auth/user-store';
import { LocalStore } from '../local-store/local-store';
import { ProductCatalog } from '../local-store/product-catalog';
import { ProductReader } from '../products/product-reader';
import { buildOrderWorkbook, formatOrderQuantity, ORDER_COLUMNS, renderOrderHtml, TOTAL_LABEL } from './order-document';
import { OrderExporter, suggestedFileName, type ExportPorts } from './order-exporter';
import { PurchaseOrderService } from './purchase-order-service';
import { SupplierService } from './supplier-service';

const TENANT = 'tenant-a';
const PRODUCT_A = '0193a5c0-0000-7000-8000-000000000060';
const PRODUCT_B = '0193a5c0-0000-7000-8000-000000000061';

/** An order as the screen would read it: two lines, one of them with no cost, and characters that HTML would misread. */
function sampleOrder(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: '0193a5c0-0000-7000-8000-000000000400',
    folio: 7,
    supplierId: '0193a5c0-0000-7000-8000-000000000300',
    supplierName: 'Ferretera del Centro',
    status: 'draft',
    notes: 'Entregar en la bodega',
    createdAt: '2026-11-11T16:00:00.000Z',
    updatedAt: '2026-11-11T16:30:00.000Z',
    sentAt: null,
    revision: 1,
    lines: [
      {
        lineNumber: 1,
        productId: PRODUCT_A,
        description: 'Cinta métrica 5 m',
        supplierCode: '000123',
        barcode: '0075012345678',
        unit: 'piece',
        quantityMilli: 12_000,
        unitCostE6: 52_250_000,
        lineTotalCents: 62_700,
      },
      {
        lineNumber: 2,
        productId: PRODUCT_B,
        description: 'Cable THW <12> & "negro"',
        supplierCode: null,
        barcode: null,
        unit: 'meter',
        quantityMilli: 2_500,
        unitCostE6: null,
        lineTotalCents: null,
      },
    ],
    totalCents: 62_700,
    linesWithoutCost: 1,
    ...overrides,
  };
}

describe('the spreadsheet of an order (E1-44)', () => {
  async function readBack(order: PurchaseOrder): Promise<ExcelJS.Worksheet> {
    const workbook = new ExcelJS.Workbook();
    // The typings of exceljs ask for their own Buffer interface, which Node's Buffer satisfies.
    await workbook.xlsx.load((await buildOrderWorkbook(order, 'Tlapalería La Esperanza')) as unknown as ExcelJS.Buffer);
    return workbook.getWorksheet('Pedido')!;
  }

  function rowsOf(sheet: ExcelJS.Worksheet): (ExcelJS.CellValue[])[] {
    const rows: ExcelJS.CellValue[][] = [];
    sheet.eachRow((row) => rows.push((row.values as ExcelJS.CellValue[]).slice(1)));
    return rows;
  }

  it('can be read back with the same library, with the header, the columns, the lines and the total', async () => {
    const sheet = await readBack(sampleOrder());
    const rows = rowsOf(sheet);

    expect(sheet.getCell('A1').value).toBe('Tlapalería La Esperanza');
    expect(rows.find((row) => row[0] === 'Proveedor')?.[1]).toBe('Ferretera del Centro');
    expect(rows.find((row) => row[0] === 'Folio')?.[1]).toBe('PED-0007');
    expect(rows.find((row) => row[0] === 'Fecha')?.[1]).toMatch(/2026/);
    const header = rows.findIndex((row) => row[0] === ORDER_COLUMNS[0]);
    expect(rows[header]).toEqual([...ORDER_COLUMNS]);
    expect(rows[header + 1]).toEqual(['000123', 'Cinta métrica 5 m', '0075012345678', 12, 'pza', 52.25, 627]);
    expect(rows[header + 2]?.[1]).toBe('Cable THW <12> & "negro"');
    expect(rows[header + 2]?.[3]).toBe(2.5);
    expect(rows[header + 2]?.[4]).toBe('m');
    const total = rows.find((row) => row.includes(TOTAL_LABEL));
    expect(total?.at(-1)).toBe(627);
  });

  it('keeps the codes as text so a leading zero survives, and leaves an unknown cost empty instead of writing zero', async () => {
    const sheet = await readBack(sampleOrder());
    const rows = rowsOf(sheet);
    const header = rows.findIndex((row) => row[0] === ORDER_COLUMNS[0]);

    expect(typeof rows[header + 1]?.[0]).toBe('string');
    expect(rows[header + 1]?.[0]).toBe('000123');
    expect(typeof rows[header + 1]?.[2]).toBe('string');
    expect(rows[header + 2]?.[5] ?? null).toBeNull();
    expect(rows[header + 2]?.[6] ?? null).toBeNull();
    expect(JSON.stringify(rows)).toContain('1 renglón(es) sin costo no están en el total.');
  });

  it('never turns text typed by a person into a formula', async () => {
    const order = sampleOrder();
    const sheet = await readBack({ ...order, lines: [{ ...order.lines[0]!, description: '=HYPERLINK("http://example.com")' }] });
    const cell = sheet.getRow(7).getCell(2);

    expect(cell.type).toBe(ExcelJS.ValueType.String);
    expect(cell.value).toBe('=HYPERLINK("http://example.com")');
  });

  it('writes the date of the day it was sent for a sent order', async () => {
    const sheet = await readBack(sampleOrder({ status: 'sent', sentAt: '2026-12-24T18:00:00.000Z' }));

    expect(rowsOf(sheet).find((row) => row[0] === 'Fecha')?.[1]).toMatch(/diciembre de 2026/);
  });
});

describe('the page that is printed to PDF (E1-44)', () => {
  it('has the header, the supplier, the date, the folio, the columns, every line and the total', () => {
    const html = renderOrderHtml(sampleOrder(), 'Tlapalería La Esperanza');

    expect(html).toContain('<h1>Tlapalería La Esperanza</h1>');
    expect(html).toContain('Pedido al proveedor');
    expect(html).toContain('<dd>Ferretera del Centro</dd>');
    expect(html).toContain('<dd>PED-0007</dd>');
    expect(html).toMatch(/<dt>Fecha<\/dt><dd>[^<]*2026[^<]*<\/dd>/);
    for (const column of ORDER_COLUMNS) {
      expect(html).toContain(`<th>${column}</th>`);
    }
    expect(html).toContain('<td>000123</td>');
    expect(html).toContain('<td>0075012345678</td>');
    expect(html).toContain('<td class="number">12</td>');
    expect(html).toContain('<td class="number">2.500</td>');
    expect(html).toContain('<td>pza</td>');
    expect(html).toContain('<td class="number">$52.25</td>');
    expect(html).toContain('<td class="number">$627.00</td>');
    expect(html).toContain(`${TOTAL_LABEL}</td><td class="number">$627.00</td>`);
    expect(html).toContain('Entregar en la bodega');
    expect(html).toContain('1 renglón(es) sin costo no están en el total.');
  });

  it('escapes everything that a person typed, and loads nothing and runs nothing', () => {
    const html = renderOrderHtml(sampleOrder({ supplierName: '<script>alert(1)</script>', notes: '"><img src=x onerror=alert(1)>' }), 'A & B');

    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Cable THW &lt;12&gt; &amp; &quot;negro&quot;');
    expect(html).toContain('<h1>A &amp; B</h1>');
    expect(html).toContain("default-src 'none'");
  });

  it('shows a dash where the code, the barcode or the cost is unknown', () => {
    const html = renderOrderHtml(sampleOrder(), 'Tlapalería');

    expect(html.match(/<td>—<\/td>/g)).toHaveLength(2);
    expect(html).toContain('<td class="number">—</td>');
  });

  it('writes quantities whole for pieces and with three decimals for what is measured', () => {
    expect(formatOrderQuantity(3_000, 'piece')).toBe('3');
    expect(formatOrderQuantity(3_275, 'meter')).toBe('3.275');
    expect(formatOrderQuantity(500, 'kilogram')).toBe('0.500');
  });
});

describe('the files of an order (E1-44)', () => {
  let directory: string;
  let store: LocalStore;
  let auth: AuthService;
  let orders: PurchaseOrderService;
  let exporter: OrderExporter;
  let ports: ExportPorts;
  let chosen: { name: string; format: OrderFileFormat }[];
  let printed: string[];
  let revealed: string[];
  let savePath: string | null;
  let orderId: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'order-export-'));
    store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
    auth = new AuthService(new UserStore(store, TENANT));
    const owner = auth.setupOwner('Mauricio', '4321');
    auth.login(owner.id, '4321');
    auth.createUser('Ana', 'cashier', '5555');
    const audit = new AuditLog(store, TENANT);
    const suppliers = new SupplierService(store, TENANT, auth, audit);
    orders = new PurchaseOrderService(store, TENANT, auth, audit, suppliers, new ProductReader(store, TENANT), new ProductCatalog(store, TENANT));
    store.transaction((connection) => {
      connection.exec(`INSERT INTO product (id, tenant_id, name, base_unit, unit_price_e4, tax_factor, tax_rate_bp) VALUES ('${PRODUCT_A}', '${TENANT}', 'Cinta métrica 5 m', 'piece', 895000, 'rate', 1600)`);
    });
    const supplier = suppliers.save({ name: 'Ferretera / del Centro: "Norte"', contact: null, notes: null, isActive: true });
    if (supplier.status !== 'saved') {
      throw new Error('The supplier was not saved');
    }
    const saved = orders.save({
      supplierId: supplier.supplier.id,
      notes: null,
      lines: [{ productId: PRODUCT_A, supplierCode: '000123', quantityMilli: 12_000, unitCostE6: 52_250_000 }],
    });
    if (saved.status !== 'saved') {
      throw new Error('The order was not saved');
    }
    orderId = saved.order.id;
    chosen = [];
    printed = [];
    revealed = [];
    savePath = join(directory, 'pedido');
    ports = {
      chooseSavePath: (name, format) => {
        chosen.push({ name, format });
        return Promise.resolve(savePath === null ? null : `${savePath}.${format}`);
      },
      renderPdf: (html) => {
        printed.push(html);
        return Promise.resolve(Buffer.from('%PDF-1.7 fake'));
      },
      revealInFolder: (path) => revealed.push(path),
      businessName: () => 'Tlapalería La Esperanza',
    };
    exporter = new OrderExporter(auth, audit, (id) => orders.get(id), ports);
  });

  afterEach(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function auditActions(): string[] {
    return (store.prepare("SELECT action FROM audit_log WHERE action LIKE 'purchase_order.export%' ORDER BY rowid").all() as unknown as { action: string }[]).map((row) => row.action);
  }

  it('suggests a name with the folio and the supplier, without the characters Windows refuses', async () => {
    await exporter.export({ orderId, format: 'xlsx' });

    expect(chosen).toEqual([{ name: 'PED-0001 Ferretera del Centro Norte.xlsx', format: 'xlsx' }]);
    expect(suggestedFileName({ folio: 12, supplierName: '   ' }, 'pdf')).toBe('PED-0012.pdf');
    expect(suggestedFileName({ folio: 3, supplierName: 'CON...' }, 'pdf')).toBe('PED-0003 CON.pdf');
  });

  it('writes an Excel file that opens with the content of the order, and writes it in the audit log', async () => {
    const result = await exporter.export({ orderId, format: 'xlsx' });

    expect(result).toEqual({ status: 'saved', path: join(directory, 'pedido.xlsx') });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(join(directory, 'pedido.xlsx'));
    const sheet = workbook.getWorksheet('Pedido')!;
    expect(sheet.getCell('A1').value).toBe('Tlapalería La Esperanza');
    expect(sheet.getRow(7).getCell(1).value).toBe('000123');
    expect(sheet.getRow(8).getCell(6).value).toBe('Total estimado');
    expect(sheet.getRow(8).getCell(7).value).toBe(627);
    expect(auditActions()).toEqual(['purchase_order.export']);
  });

  it('prints the page of the order to PDF with the engine of the app and saves what it printed', async () => {
    const result = await exporter.export({ orderId, format: 'pdf' });

    expect(result).toEqual({ status: 'saved', path: join(directory, 'pedido.pdf') });
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain('<h1>Tlapalería La Esperanza</h1>');
    expect(printed[0]).toContain('PED-0001');
    expect(printed[0]).toContain('$627.00');
    expect(readFileSync(join(directory, 'pedido.pdf')).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('writes nothing when the person closes the window to choose where to save', async () => {
    savePath = null;

    expect(await exporter.export({ orderId, format: 'pdf' })).toEqual({ status: 'cancelled' });

    expect(printed).toEqual([]);
    expect(auditActions()).toEqual([]);
    expect(existsSync(join(directory, 'pedido.pdf'))).toBe(false);
  });

  it('answers with a message when the file cannot be written, instead of failing', async () => {
    savePath = join(directory, 'missing-folder', 'pedido');

    const result = await exporter.export({ orderId, format: 'xlsx' });

    expect(result).toMatchObject({ status: 'failed', message: expect.any(String) });
    expect(auditActions()).toEqual([]);
  });

  it('answers not found for an order that does not exist', async () => {
    expect(await exporter.export({ orderId: '0193a5c0-0000-7000-8000-000000000999', format: 'xlsx' })).toEqual({ status: 'not_found' });
  });

  it('needs the PIN of an owner from a cashier, and writes the refusals in the audit log', async () => {
    auth.logout();
    const cashier = auth.listUsers().find((user) => user.role === 'cashier')!;
    auth.login(cashier.id, '5555');

    expect(await exporter.export({ orderId, format: 'xlsx' })).toEqual({ status: 'authorization_required' });
    expect(await exporter.export({ orderId, format: 'xlsx', ownerPin: '0000' })).toMatchObject({ status: 'wrong_pin' });
    expect(chosen).toEqual([]);
    expect(auditActions()).toEqual(['purchase_order.export_denied', 'purchase_order.export_denied']);
    expect(await exporter.export({ orderId, format: 'xlsx', ownerPin: '4321' })).toMatchObject({ status: 'saved' });
  });

  it('shows in its folder only a file it just wrote', async () => {
    const { path } = (await exporter.export({ orderId, format: 'xlsx' })) as { path: string };

    exporter.reveal(path);
    exporter.reveal('C:\\Windows\\System32\\cmd.exe');

    expect(revealed).toEqual([path]);
  });

  it('does not change the order or the stock', async () => {
    const before = orders.get(orderId);
    await exporter.export({ orderId, format: 'xlsx' });
    await exporter.export({ orderId, format: 'pdf' });

    expect(orders.get(orderId)).toEqual(before);
    expect((store.prepare('SELECT count(*) AS total FROM stock_movement').get() as unknown as { total: number }).total).toBe(0);
  });
});
