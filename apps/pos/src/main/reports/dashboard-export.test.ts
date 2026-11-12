import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, inflateRawSync } from 'node:zlib';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { UserSummary } from '../../shared/auth';
import type { DashboardRequest, DashboardSummary } from '../../shared/dashboard-api';
import { AuditLog } from '../audit/audit-log';
import { AuthService } from '../auth/auth-service';
import { OwnerGate } from '../auth/owner-gate';
import { UserStore } from '../auth/user-store';
import { LocalStore } from '../local-store/local-store';
import { DashboardFixture } from './dashboard-fixtures';
import { exportFileName, summaryHtml, summarySheets } from './dashboard-export';
import { DashboardExporter } from './dashboard-exporter';
import { DashboardService } from './dashboard-service';
import { buildWorkbook } from '../export/xlsx';

const TENANT = 'tenant-a';

/** What an Excel file holds, read back with nothing but a zip reader: the sheets, their rows, and the cells as text. */
function readWorkbook(bytes: Buffer): Record<string, string[][]> {
  const files = new Map<string, string>();
  const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(0);
  const entryCount = bytes.readUInt16LE(end + 10);
  let position = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < entryCount; index += 1) {
    expect(bytes.readUInt32LE(position)).toBe(0x02014b50);
    const [method, checksum, packedSize, size, nameLength, extraLength, commentLength, localOffset] = [
      bytes.readUInt16LE(position + 10),
      bytes.readUInt32LE(position + 16),
      bytes.readUInt32LE(position + 20),
      bytes.readUInt32LE(position + 24),
      bytes.readUInt16LE(position + 28),
      bytes.readUInt16LE(position + 30),
      bytes.readUInt16LE(position + 32),
      bytes.readUInt32LE(position + 42),
    ];
    const name = bytes.toString('utf8', position + 46, position + 46 + nameLength);
    expect(bytes.readUInt32LE(localOffset)).toBe(0x04034b50);
    const dataStart = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
    expect(method).toBe(8);
    const content = inflateRawSync(bytes.subarray(dataStart, dataStart + packedSize));
    expect(content.length).toBe(size);
    expect(crc32(content)).toBe(checksum);
    files.set(name, content.toString('utf8'));
    position += 46 + nameLength + extraLength + commentLength;
  }
  const unescape = (text: string): string => text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  const workbook = files.get('xl/workbook.xml')!;
  const sheets: Record<string, string[][]> = {};
  for (const [, name, id] of workbook.matchAll(/<sheet name="([^"]*)" sheetId="\d+" r:id="(rId\d+)"\/>/g)) {
    const target = files.get('xl/_rels/workbook.xml.rels')!.match(new RegExp(`Id="${id}"[^>]*Target="([^"]+)"`))![1]!;
    const xml = files.get(`xl/${target}`)!;
    sheets[unescape(name!)] = [...xml.matchAll(/<row r="\d+">(.*?)<\/row>/g)].map(([, row]) =>
      [...row!.matchAll(/<c r="[A-Z]+\d+"[^>]*?(?:\/>|>(.*?)<\/c>)/g)].map(([, cell]) => unescape((cell ?? '').replace(/<\/?(?:is|t|v)[^>]*>/g, ''))),
    );
  }
  return sheets;
}

let directory: string;
let store: LocalStore;
let fixture: DashboardFixture;
let service: DashboardService;
let owner: UserSummary;
let cashier: UserSummary;
let hammer: string;
let cable: string;

const at = (local: string): string => new Date(`${local}-06:00`).toISOString();
const request = (overrides: Partial<DashboardRequest> = {}): DashboardRequest => ({ period: 'day', date: '2026-11-10', topMetric: 'quantity', topLimit: 10, ...overrides });

function summaryFor(user: UserSummary, overrides: Partial<DashboardRequest> = {}): DashboardSummary {
  const result = service.summary(request(overrides), user);
  if (result.status !== 'ok') {
    throw new Error(result.status);
  }
  return result.summary;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'dashboard-export-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  const auth = new AuthService(new UserStore(store, TENANT));
  owner = auth.setupOwner('Mauricio', '4321');
  auth.login(owner.id, '4321');
  cashier = auth.createUser('Ana', 'cashier', '5555');
  fixture = new DashboardFixture(store, TENANT);
  fixture.openSession('2026-11-09T12:00:00.000Z');
  service = new DashboardService(store, TENANT, new OwnerGate(auth, new AuditLog(store, TENANT)), () => new Date('2026-11-12T18:00:00.000Z'));
  hammer = fixture.product('Martillo', 'piece', { costE6: 60_000_000 });
  fixture.stock(hammer, 100_000);
  cable = fixture.product('Cable THW', 'meter', { priceE4: 125_000 });
  fixture.stock(cable, 100_000, 5_000_000);
  const first = fixture.sale({ at: at('2026-11-10T10:00:00.000'), lines: [{ productId: hammer, milli: 2_000 }], cashierId: owner.id });
  fixture.sale({ at: at('2026-11-10T10:30:00.000'), lines: [{ productId: hammer, milli: 1_000 }, { productId: cable, milli: 3_275 }], cashierId: cashier.id, pay: ['cash', 'card'] });
  fixture.saleReturn(first, 0, 1_000, at('2026-11-10T15:00:00.000'), 11_600);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('the Excel file', () => {
  it('can be read back with the same numbers the screen shows, written as exact decimals', () => {
    const workbook = readWorkbook(buildWorkbook(summarySheets(summaryFor(owner, { topMetric: 'amount' }))));

    expect(Object.keys(workbook)).toEqual(['Resumen', 'Formas de pago', 'Por hora', 'Por día de la semana', 'Por día', 'Más vendidos', 'Cajeros', 'Existencias']);
    const rows = Object.fromEntries(workbook['Resumen']!.filter((row) => row.length >= 2).map((row) => [row[0]!, row.slice(1)]));
    // Sales 23,200 + 15,694 = 38,894 with VAT; the return of 116.00 leaves 272.94.
    expect(rows['Ventas totales (con IVA)']).toEqual(['388.94', '0.00', 'nuevo']);
    expect(rows['Tickets']![0]).toBe('2');
    expect(rows['Venta neta (con IVA)']![0]).toBe('272.94');
    expect(rows['Utilidad bruta']![0]).toBe('98.91');
    expect(rows['Margen (%)']![0]).toBe('42.04');
    expect(rows['Valor del inventario a costo']![0]).toBe('6363.63');
    expect(workbook['Más vendidos']![2]).toEqual(['1', 'Martillo', 'Pieza', '3.000', '348.00', '60.000000', '120.00', 'Capturado']);
    expect(workbook['Más vendidos']![3]).toEqual(['2', 'Cable THW', 'Metro', '3.275', '40.94', '5.000000', '18.91', 'Promedio ponderado']);
    expect(workbook['Por hora']!).toHaveLength(25);
    expect(workbook['Por hora']![11]).toEqual(['10:00', '2', '388.94']);
  });

  it('keeps a text that looks like a formula as text, and special characters intact', () => {
    fixture.sale({ at: at('2026-11-10T11:00:00.000'), lines: [{ productId: fixture.product('=HYPERLINK("http://x")&<b>Sierra</b> ñandú', 'piece'), milli: 1_000 }] });

    const bytes = buildWorkbook(summarySheets(summaryFor(owner)));
    const workbook = readWorkbook(bytes);

    expect(workbook['Más vendidos']!.some((row) => row[1] === '=HYPERLINK("http://x")&<b>Sierra</b> ñandú')).toBe(true);
    expect(inflateAll(bytes)).not.toContain('<f>');
  });

  it('gives a cashier the file of their shift without costs, cashiers or inventory', () => {
    // The register is open, so the shift of Ana is the sales she made in it.
    fixture.sale({ at: '2026-11-12T15:00:00.000Z', lines: [{ productId: hammer, milli: 1_000 }], cashierId: cashier.id });

    const workbook = readWorkbook(buildWorkbook(summarySheets(summaryFor(cashier))));

    expect(Object.keys(workbook)).toEqual(['Resumen', 'Formas de pago', 'Por hora', 'Por día de la semana', 'Por día', 'Más vendidos']);
    const everything = JSON.stringify(workbook);
    expect(everything).not.toMatch(/Utilidad|Costo|Margen|inventario/);
    expect(workbook['Más vendidos']![1]).toEqual(['#', 'Producto', 'Unidad', 'Cantidad', 'Importe (con IVA)']);
  });

  it('refuses a sheet name Excel would not open', () => {
    expect(() => buildWorkbook([{ name: 'a/b', rows: [] }])).toThrow(TypeError);
    expect(() => buildWorkbook([{ name: 'x'.repeat(32), rows: [] }])).toThrow(TypeError);
    expect(() => buildWorkbook([{ name: 'Hoja', rows: [] }, { name: 'hoja', rows: [] }])).toThrow(TypeError);
    expect(() => buildWorkbook([{ name: 'Hoja', rows: [[{ decimal: '1e5', format: 'money' }]] }])).toThrow(TypeError);
  });

  it('names the file after the period', () => {
    expect(exportFileName(summaryFor(owner), 'xlsx')).toBe('resumen-2026-11-10.xlsx');
    expect(exportFileName(summaryFor(owner, { period: 'month' }), 'pdf')).toBe('resumen-2026-11-01_a_2026-11-30.pdf');
  });
});

function inflateAll(bytes: Buffer): string {
  // Every part is a deflated file, so the formulas would be inside them: read them all with the same reader as the test.
  const text: string[] = [];
  let position = 0;
  while ((position = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), position)) !== -1) {
    const packed = bytes.readUInt32LE(position + 18);
    const start = position + 30 + bytes.readUInt16LE(position + 26) + bytes.readUInt16LE(position + 28);
    text.push(inflateRawSync(bytes.subarray(start, start + packed)).toString('utf8'));
    position = start + packed;
  }
  return text.join('\n');
}

describe('the page of the PDF', () => {
  it('has the same numbers as the screen, in tables', () => {
    const html = summaryHtml(summaryFor(owner), 'Tlapalería La Esquina');

    expect(html).toContain('<h1>Tlapalería La Esquina</h1>');
    expect(html).toContain('<th scope="row">Ventas totales (con IVA)</th><td>$388.94</td>');
    expect(html).toContain('<th scope="row">Margen (%)</th><td>42.04 %</td>');
    expect(html).toContain('<th scope="row">2. Martillo</th><td>3 pza</td>');
    expect(html).toContain('3.275 m');
    expect(html).toContain('Valor del inventario a costo: $6,363.63');
  });

  it('escapes what a person typed and blocks scripts and the network', () => {
    fixture.sale({ at: at('2026-11-10T11:00:00.000'), lines: [{ productId: fixture.product('<script>alert(1)</script>', 'piece'), milli: 1_000 }] });

    const html = summaryHtml(summaryFor(owner), '<img src=x onerror=alert(1)>');

    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain("default-src 'none'");
  });

  it('leaves out costs and inventory for a cashier', () => {
    // The register is open, so the shift of Ana is the sales she made in it.
    fixture.sale({ at: '2026-11-12T15:00:00.000Z', lines: [{ productId: hammer, milli: 1_000 }], cashierId: cashier.id });

    const html = summaryHtml(summaryFor(cashier), 'Tlapalería');

    expect(html).not.toMatch(/Utilidad|Costo|Margen|inventario|Cajero/);
    expect(html).toContain('Resumen de mi turno');
  });
});

describe('saving the files', () => {
  function exporter(overrides: { path?: string | null; fail?: boolean } = {}): { exporter: DashboardExporter; dialogs: string[]; printed: string[]; written: string[] } {
    const dialogs: string[] = [];
    const printed: string[] = [];
    const written: string[] = [];
    const path = overrides.path === undefined ? join(directory, 'resumen.out') : overrides.path;
    return {
      dialogs,
      printed,
      written,
      exporter: new DashboardExporter(service, {
        pickSavePath: (title, name, filter, extension) => {
          dialogs.push(`${title}|${name}|${filter}|${extension}`);
          return Promise.resolve(path);
        },
        renderPdf: (html) => {
          printed.push(html);
          return Promise.resolve(Buffer.from('%PDF-fake'));
        },
        businessName: () => 'Tlapalería',
        writeFile: (target, bytes) => {
          if (overrides.fail === true) {
            throw new Error('disk full');
          }
          written.push(target);
          // Writes for real so the file can be read back.
          writeFileSync(target, bytes);
        },
      }),
    };
  }

  it('saves an Excel file where the owner chose', async () => {
    const { exporter: target, dialogs, written } = exporter();

    const result = await target.export(request(), 'xlsx', owner);

    expect(result).toEqual({ status: 'saved', path: join(directory, 'resumen.out') });
    expect(dialogs).toEqual(['Guardar el resumen en Excel|resumen-2026-11-10.xlsx|Libro de Excel|xlsx']);
    expect(written).toEqual([join(directory, 'resumen.out')]);
  });

  it('prints the page to a PDF', async () => {
    const { exporter: target, printed, dialogs } = exporter();

    const result = await target.export(request({ period: 'week' }), 'pdf', owner);

    expect(result.status).toBe('saved');
    expect(printed).toHaveLength(1);
    expect(printed[0]).toContain('Ventas totales (con IVA)');
    expect(dialogs[0]).toContain('Documento PDF|pdf');
  });

  it('writes nothing when the owner cancels the window', async () => {
    const { exporter: target, written, printed } = exporter({ path: null });

    expect(await target.export(request(), 'pdf', owner)).toEqual({ status: 'cancelled' });
    expect(written).toEqual([]);
    expect(printed).toEqual([]);
    expect(existsSync(join(directory, 'resumen.out'))).toBe(false);
  });

  it('tells the person when the file could not be written', async () => {
    const { exporter: target } = exporter({ fail: true });

    const result = await target.export(request(), 'xlsx', owner);

    expect(result).toMatchObject({ status: 'failed' });
    expect(JSON.stringify(result)).not.toContain('disk full');
  });

  it('does not open the window for a cashier with a wrong PIN, and exports only the shift without one', async () => {
    const { exporter: target, dialogs } = exporter();

    expect(await target.export(request({ ownerPin: '0000' }), 'xlsx', cashier)).toMatchObject({ status: 'wrong_pin' });
    expect(dialogs).toEqual([]);
    expect(await target.export(request(), 'xlsx', cashier)).toMatchObject({ status: 'saved' });
    const workbook = readWorkbook(readFileSync(join(directory, 'resumen.out')));
    expect(Object.keys(workbook)).not.toContain('Existencias');
  });
});
