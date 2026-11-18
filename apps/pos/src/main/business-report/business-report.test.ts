import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserSummary } from '../../shared/auth';
import type { BusinessReportRequest } from '../../shared/dashboard-api';
import { AuditLog } from '../audit/audit-log';
import { AuthService } from '../auth/auth-service';
import { OwnerGate } from '../auth/owner-gate';
import { UserStore } from '../auth/user-store';
import { LocalStore } from '../local-store/local-store';
import { DashboardFixture } from '../reports/dashboard-fixtures';
import { DashboardService } from '../reports/dashboard-service';
import { parseBusinessReportRequest } from '../reports/dashboard-request';
import { uuidV7 } from '../uuid-v7';
import { ReportExporter, type ReportExporterDependencies } from './report-exporter';
import { businessReportFileName, businessReportHtml, wholePesosLabel } from './report-html';
import { ReportReader } from './report-reader';
import { shareOf, statementReading } from './report-readings';

const TENANT = 'tenant-a';
const CST = '-06:00';
const SECTIONS = [
  'De un vistazo',
  'Estado de resultados',
  'Ventas',
  'Productos y costos',
  'Gastos',
  'Caja',
  'Inventario',
  'Devoluciones y cancelaciones',
  'Proveedores',
  'Notas y glosario',
];

let directory: string;
let store: LocalStore;
let fixture: DashboardFixture;
let auth: AuthService;
let owner: UserSummary;
let cashier: UserSummary;
let service: DashboardService;
let hammer: string;
let mystery: string;
const now = new Date('2026-11-12T18:00:00.000Z');

function at(local: string): string {
  return new Date(`${local}${CST}`).toISOString();
}

interface Harness {
  readonly exporter: ReportExporter;
  readonly renderPdf: ReturnType<typeof vi.fn<(html: string, footer: string) => Promise<Buffer>>>;
  readonly writeFile: ReturnType<typeof vi.fn<(path: string, bytes: Buffer) => void>>;
  readonly pickSavePath: ReturnType<typeof vi.fn<ReportExporterDependencies['pickSavePath']>>;
}

function harness(overrides: Partial<ReportExporterDependencies> = {}): Harness {
  const renderPdf = vi.fn((_html: string, _footer: string) => Promise.resolve(Buffer.from('%PDF-1.7')));
  const writeFile = vi.fn((_path: string, _bytes: Buffer) => undefined);
  const pickSavePath = vi.fn<ReportExporterDependencies['pickSavePath']>(() => Promise.resolve('C:\\Documentos\\reporte.pdf'));
  const exporter = new ReportExporter({
    view: service,
    reader: new ReportReader(store, TENANT),
    gate: new OwnerGate(auth, new AuditLog(store, TENANT)),
    audit: new AuditLog(store, TENANT),
    pickSavePath,
    renderPdf,
    businessName: () => 'Tlapalería <Torres>',
    accent: () => 'blue',
    writeFile,
    now: () => now,
    ...overrides,
  });
  return { exporter, renderPdf, writeFile, pickSavePath };
}

function htmlOf(renderPdf: Harness['renderPdf']): string {
  return renderPdf.mock.calls[0]?.[0] ?? '';
}

function auditRows(): { action: string; user_id: string; detail: string }[] {
  return store.prepare("SELECT action, user_id, detail FROM audit_log WHERE entity_id = 'business_report' ORDER BY rowid").all() as unknown as {
    action: string;
    user_id: string;
    detail: string;
  }[];
}

const DAY: BusinessReportRequest = { period: 'day', date: '2026-11-10' };

function expense(concept: string, amountCents: number, fromDrawer: string | null): void {
  store
    .prepare(
      'INSERT INTO expense (id, tenant_id, concept, amount_cents, expense_day, note, paid_from_drawer, cash_movement_id, recorded_by, authorized_by, recorded_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)',
    )
    .run(uuidV7(), TENANT, concept, amountCents, '2026-11-10', fromDrawer === null ? 0 : 1, fromDrawer, owner.id, owner.id, at('2026-11-10T12:00:00.000'));
}

/** Opens a shift of Ana with a float of $500.00 and a drawer expense of $80.00. */
function seedCash(): string {
  const sessionId = uuidV7();
  store
    .prepare('INSERT INTO cash_session (id, tenant_id, opened_by, opened_at, opening_float_cents) VALUES (?, ?, ?, ?, ?)')
    .run(sessionId, TENANT, cashier.id, at('2026-11-10T08:00:00.000'), 50_000);
  const movementId = uuidV7();
  store
    .prepare('INSERT INTO cash_movement (id, tenant_id, session_id, kind, amount_cents, reason, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(movementId, TENANT, sessionId, 'out', 8_000, 'Gasto: Limpieza', cashier.id, at('2026-11-10T11:00:00.000'));
  expense('Limpieza', 8_000, movementId);
  return sessionId;
}

/** Closes the shift with a cut where $20.00 of cash is missing. */
function cutShift(sessionId: string): void {
  store
    .prepare(
      `INSERT INTO cash_cut (id, tenant_id, session_id, cut_by, cut_at, expected_cash_cents, counted_cash_cents, expected_card_cents, counted_card_cents,
                             expected_transfer_cents, counted_transfer_cents, denominations, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(uuidV7(), TENANT, sessionId, cashier.id, at('2026-11-10T20:00:00.000'), 100_000, 98_000, 0, 0, 0, 0, '{}', 'Faltó cambio');
  store.prepare('UPDATE cash_session SET closed_by = ?, closed_at = ? WHERE id = ?').run(cashier.id, at('2026-11-10T20:00:00.000'), sessionId);
}

function seedDraftOrder(): void {
  const supplierId = uuidV7();
  store.prepare('INSERT INTO supplier (id, tenant_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(supplierId, TENANT, 'Truper', now.toISOString(), now.toISOString());
  const orderId = uuidV7();
  store
    .prepare("INSERT INTO purchase_order (id, tenant_id, folio, supplier_id, supplier_name, status, created_by, created_at, updated_at) VALUES (?, ?, 1, ?, 'Truper', 'draft', ?, ?, ?)")
    .run(orderId, TENANT, supplierId, owner.id, at('2026-11-10T09:00:00.000'), at('2026-11-10T09:00:00.000'));
  const line = store.prepare(
    'INSERT INTO purchase_order_line (id, tenant_id, order_id, line_number, product_id, description, unit, quantity_milli, unit_cost_e6, line_total_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  line.run(uuidV7(), TENANT, orderId, 1, hammer, 'Martillo', 'piece', 10_000, 60_000_000, 60_000);
  line.run(uuidV7(), TENANT, orderId, 2, mystery, 'Sin costo', 'piece', 1_000, null, null);
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'business-report-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  auth = new AuthService(new UserStore(store, TENANT));
  owner = auth.setupOwner('Mauricio', '4321');
  auth.login(owner.id, '4321');
  cashier = auth.createUser('Ana', 'cashier', '5555');
  fixture = new DashboardFixture(store, TENANT);
  service = new DashboardService(store, TENANT, new OwnerGate(auth, new AuditLog(store, TENANT)), () => now);
  // A hammer at $116.00 with VAT (base $100.00) that costs $60.00, and a product nobody knows the cost of.
  hammer = fixture.product('Martillo', 'piece', { costE6: 60_000_000 });
  fixture.stock(hammer, 100_000);
  mystery = fixture.product('Pija <b>sin costo</b>', 'piece');
  fixture.stock(mystery, 10_000);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('the illustrated report of a period without movement', () => {
  it('still has every section, says there was nothing, and saves the file', async () => {
    const { exporter, renderPdf, writeFile } = harness();

    const result = await exporter.export(DAY, owner);

    expect(result).toEqual({ status: 'saved', path: 'C:\\Documentos\\reporte.pdf' });
    expect(writeFile).toHaveBeenCalledWith('C:\\Documentos\\reporte.pdf', Buffer.from('%PDF-1.7'));
    const html = htmlOf(renderPdf);
    for (const section of SECTIONS) {
      expect(html).toContain(`<h2>${section}</h2>`);
    }
    expect(html).toContain('En este periodo no hubo ventas.');
    expect(html).toContain('No se hizo ningún corte en el periodo.');
    expect(html).toContain('No anotaste gastos en el periodo');
  });
});

describe('the illustrated report with sales, returns, expenses and cash', () => {
  beforeEach(() => {
    // The sales go in a shift the fixture opened long ago, which is closed before Ana opens hers.
    const first = fixture.sale({ at: at('2026-11-10T10:00:00.000'), lines: [{ productId: hammer, milli: 2_000 }], cashierId: cashier.id, pay: ['cash'] });
    fixture.sale({ at: at('2026-11-10T13:00:00.000'), lines: [{ productId: mystery, milli: 1_000 }], cashierId: cashier.id, pay: ['card'] });
    fixture.saleReturn(first, 0, 1_000, at('2026-11-10T15:00:00.000'), 11_600);
    fixture.closeSession(fixture.openSession(), at('2026-11-10T16:00:00.000'));
    cutShift(seedCash());
    expense('Renta', 300_000, null);
    seedDraftOrder();
  });

  it('reads the cash of each cashier: floats, cuts and the missing cash', () => {
    const extras = new ReportReader(store, TENANT).read(at('2026-11-10T00:00:00.000'), at('2026-11-11T00:00:00.000'));

    expect(extras.cashiers).toEqual([
      { name: 'Ana', sessions: 1, openingFloatCents: 50_000, cuts: 1, cutsWithDifference: 1, cashDifferenceCents: -2_000, otherDifferenceCents: 0 },
    ]);
    expect(extras.purchases).toEqual({ draftCount: 1, draftTotalCents: 60_000, sentCount: 0, sentTotalCents: 0, linesWithoutCost: 1 });
  });

  it('leaves a shift opened on another day out of the period', () => {
    const extras = new ReportReader(store, TENANT).read(at('2026-11-11T00:00:00.000'), at('2026-11-12T00:00:00.000'));

    expect(extras.cashiers).toEqual([]);
    // A draft is still open whatever day it is.
    expect(extras.purchases.draftCount).toBe(1);
  });

  it('shows the loss, the drawer expense once, the missing cost and the VAT apart', async () => {
    const { exporter, renderPdf } = harness();

    await exporter.export(DAY, owner);
    const html = htmlOf(renderPdf);

    // Net sales: two hammers and the screw ($300.00 before VAT) minus a hammer returned = $200.00. One hammer left at a
    // cost of $60.00; the screw has no cost, so it is flagged. Expenses: rent $3,000.00 and $80.00 from the drawer.
    expect(html).toContain('En este periodo el negocio perdió $2,940.00');
    expect(html).toContain('La pérdida equivale a 1470.00 % de las ventas netas.');
    expect(html).toContain('De la caja salieron $80.00; ya se restaron en el corte, una sola vez.');
    expect(html).toContain('1 producto(s) vendidos sin costo');
    expect(html).toContain('IVA cobrado (no es ingreso, se le paga al SAT)');
    expect(html).toContain('en efectivo faltaron $20.00');
    expect(html).toContain('Hay 1 pedido(s) en borrador por $600.00');
    expect(html).toContain('1 renglón(es) no tienen costo');
  });

  it('escapes the name of the business and of every product', async () => {
    const { exporter, renderPdf } = harness();

    await exporter.export(DAY, owner);
    const html = htmlOf(renderPdf);

    expect(html).not.toContain('<b>sin costo</b>');
    expect(html).toContain('Pija &lt;b&gt;sin costo&lt;/b&gt;');
    expect(html).not.toContain('<Torres>');
    expect(html).toContain("content=\"default-src 'none'; style-src 'unsafe-inline'\"");
    expect(html).not.toMatch(/<script|https?:\/\//);
  });

  it('puts the name of the business and the period at the foot of every page', async () => {
    const { exporter, renderPdf } = harness();

    await exporter.export(DAY, owner);

    expect(renderPdf.mock.calls[0]?.[1]).toBe('Tlapalería <Torres> · Reporte del negocio · 10 nov 2026');
  });
});

describe('who may export the illustrated report', () => {
  it('asks a cashier for the PIN of an owner before the window to save, and writes the refusal down', async () => {
    const { exporter, pickSavePath } = harness();

    expect(await exporter.export(DAY, cashier)).toEqual({ status: 'authorization_required' });
    expect(pickSavePath).not.toHaveBeenCalled();
    expect(auditRows().map((row) => row.action)).toEqual(['report.business_report_denied']);
  });

  it('counts a wrong PIN', async () => {
    const { exporter, pickSavePath } = harness();

    expect(await exporter.export({ ...DAY, ownerPin: '0000' }, cashier)).toMatchObject({ status: 'wrong_pin' });
    expect(pickSavePath).not.toHaveBeenCalled();
  });

  it('saves it for a cashier with the PIN of an owner, and writes who approved and where', async () => {
    const { exporter } = harness();

    expect(await exporter.export({ ...DAY, ownerPin: '4321' }, cashier)).toMatchObject({ status: 'saved' });
    const [row] = auditRows();
    expect(row).toMatchObject({ action: 'report.business_report', user_id: cashier.id });
    expect(row?.detail).toContain(`aprobado por ${owner.id}`);
    expect(row?.detail).toContain('C:\\Documentos\\reporte.pdf');
  });

  it('writes nothing when the person cancels the window to save', async () => {
    const { exporter, renderPdf, writeFile } = harness({ pickSavePath: () => Promise.resolve(null) });

    expect(await exporter.export(DAY, owner)).toEqual({ status: 'cancelled' });
    expect(renderPdf).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
    expect(auditRows()).toEqual([]);
  });

  it('says so when the file cannot be written', async () => {
    const { exporter } = harness({
      writeFile: () => {
        throw new Error('EBUSY');
      },
    });

    expect(await exporter.export(DAY, owner)).toMatchObject({ status: 'failed' });
    expect(auditRows()).toEqual([]);
  });
});

describe('the request of the illustrated report that crosses the bridge', () => {
  it('keeps only the fields it knows', () => {
    expect(parseBusinessReportRequest({ period: 'custom', date: '2026-11-01', endDate: '2026-11-15', ownerPin: '4321', topLimit: 50 })).toEqual({
      period: 'custom',
      date: '2026-11-01',
      endDate: '2026-11-15',
      ownerPin: '4321',
    });
  });

  it.each([
    ['not an object', 'hoy'],
    ['an array', []],
    ['«Desde el inicio», which the report does not take', { period: 'all', date: '2026-11-10' }],
    ['a day that is not text', { period: 'day', date: 20_261_110 }],
    ['a last day that is not a day', { period: 'custom', date: '2026-11-10', endDate: 'mañana' }],
    ['a PIN too long', { period: 'day', date: '2026-11-10', ownerPin: '1'.repeat(33) }],
  ])('refuses %s', (_name, value) => {
    expect(() => parseBusinessReportRequest(value)).toThrow(TypeError);
  });
});

describe('the pieces of the report', () => {
  it('writes money without cents for the charts, rounded half up', () => {
    expect(wholePesosLabel(123_450)).toBe('$1,235');
    expect(wholePesosLabel(-49)).toBe('$0');
    expect(wholePesosLabel(-150)).toBe('−$2');
  });

  it('works out a share in basis points from integers', () => {
    expect(shareOf(1, 3)).toBe(3_333);
    expect(shareOf(-1, 3)).toBe(-3_333);
    expect(shareOf(5, 0)).toBeNull();
  });

  it('names the file after the period', () => {
    expect(businessReportFileName({ period: { kind: 'day', fromDay: '2026-11-10', toDay: '2026-11-10', dayCount: 1 } })).toBe('reporte-del-negocio-2026-11-10.pdf');
    expect(businessReportFileName({ period: { kind: 'month', fromDay: '2026-11-01', toDay: '2026-11-30', dayCount: 30 } })).toBe('reporte-del-negocio-2026-11-01_a_2026-11-30.pdf');
  });

  it('reads a profit as what is left of every $100', () => {
    const { statement } = service.businessView({ period: 'day', date: '2026-11-10', topMetric: 'amount', topLimit: 10 });
    expect(statementReading(statement)).toBe('En este periodo no hubo ventas, devoluciones ni gastos.');
    fixture.sale({ at: at('2026-11-10T10:00:00.000'), lines: [{ productId: hammer, milli: 1_000 }] });
    const after = service.businessView({ period: 'day', date: '2026-11-10', topMetric: 'amount', topLimit: 10 }).statement;
    // $100.00 sold before VAT, $60.00 of cost, no expenses: $40.00 of every $100.
    expect(statementReading(after)).toContain('De cada $100 que vendiste sin IVA, te quedaron $40.00');
  });

  it('falls back to a dark color when the accent is not a color', () => {
    const { summary, statement } = service.businessView({ period: 'day', date: '2026-11-10', topMetric: 'amount', topLimit: 10 });
    const html = businessReportHtml({
      businessName: 'X',
      accentColor: 'red;}</style><script>',
      generatedAt: 'hoy',
      summary,
      statement,
      extras: { cashiers: [], purchases: { draftCount: 0, draftTotalCents: 0, sentCount: 0, sentTotalCents: 0, linesWithoutCost: 0 } },
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('--accent: #33495c');
  });
});
