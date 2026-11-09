import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lineTotals, quantityOf, saleTotals, taxRateOf } from '@pos-saas/money';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { UserSummary } from '../../shared/auth';
import { AuthService } from '../auth/auth-service';
import { UserStore } from '../auth/user-store';
import { CashService } from '../cash/cash-service';
import { CashSessionStore } from '../cash/cash-session-store';
import type { SaleToSave } from '../checkout/sale-recorder';
import { StockStore } from '../inventory/stock-store';
import { LocalStore } from '../local-store/local-store';
import { SaleStore } from '../local-store/sale-store';
import { uuidV7 } from '../uuid-v7';
import { ReportService } from './report-service';

const TENANT = 'tenant-a';

let directory: string;
let store: LocalStore;
let auth: AuthService;
let reports: ReportService;
let stock: StockStore;
let sales: SaleStore;
let cash: CashService;
let owner: UserSummary;
let cableId: string;

function localDay(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const TODAY = localDay(new Date());

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'reports-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  auth = new AuthService(new UserStore(store, TENANT));
  stock = new StockStore(store, TENANT);
  reports = new ReportService(store, TENANT, auth);
  sales = new SaleStore(store, TENANT);
  cash = new CashService(new CashSessionStore(store, TENANT), auth);
  owner = auth.setupOwner('Mauricio', '4321');
  auth.login(owner.id, '4321');
  cash.open(0);
  cableId = addProduct('Cable THW', 'meter');
  // $5.00 per meter, as the cost of the opening balance.
  stock.post([{ productId: cableId, type: 'opening_balance', quantityMilli: 100_000, unitCostE6: 5_000_000, source: 'import', sourceId: 'C1' }]);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function addProduct(name: string, unit: 'piece' | 'meter'): string {
  const id = uuidV7();
  store.transaction((connection) => {
    connection
      .prepare('INSERT INTO product (id, tenant_id, name, base_unit, unit_price_e4, tax_factor, tax_rate_bp) VALUES (?, ?, ?, ?, 125000, ?, 1600)')
      .run(id, TENANT, name, unit, 'rate');
  });
  return id;
}

function sell(productId: string, milli: number, cashierId = owner.id): SaleToSave {
  const quantity = quantityOf(milli, 'meter');
  const line = { id: uuidV7(), productId, productName: 'Cable THW', quantity, unitPriceE4: 125_000, totals: lineTotals(125_000, quantity, taxRateOf('rate', 1600)) };
  const totals = saleTotals([line.totals]);
  const sale: SaleToSave = {
    saleId: uuidV7(),
    idempotencyKey: uuidV7(),
    lines: [line],
    subtotalCents: totals.subtotalCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
    cashSessionId: cash.openSessionId()!,
    cashierId,
  };
  sales.savePendingPayment(sale);
  sales.markCompleted(sale.saleId, [{ method: 'cash', amountCents: totals.totalCents, reference: null }]);
  return sale;
}

describe('the daily report', () => {
  it('adds up the day: how many sales, how much, and the average ticket', () => {
    const first = sell(cableId, 3275);
    const second = sell(cableId, 1000);

    const report = reports.daily(TODAY);

    expect(report).toMatchObject({ date: TODAY, salesCount: 2, totalCents: first.totalCents + second.totalCents });
    expect(report.averageTicketCents).toBe(Math.round((first.totalCents + second.totalCents) / 2));
  });

  it('groups the sales by the hour they happened, in local time, and by cashier', () => {
    auth.createUser('Ana', 'cashier', '5555');
    sell(cableId, 1000);
    const ana = auth.listUsers().find((user) => user.name === 'Ana')!;
    sell(cableId, 2000, ana.id);

    const report = reports.daily(TODAY);

    expect(report.byHour).toEqual([{ hour: new Date().getHours(), salesCount: 2, totalCents: report.totalCents }]);
    expect(report.byCashier.map((row) => [row.name, row.salesCount]).sort()).toEqual([
      ['Ana', 1],
      ['Mauricio', 1],
    ]);
  });

  it('is empty for a day without sales, so it never divides by zero', () => {
    sell(cableId, 1000);

    expect(reports.daily('2020-01-15')).toMatchObject({ salesCount: 0, totalCents: 0, averageTicketCents: 0, byHour: [], byCashier: [], marginCents: 0 });
  });

  it('computes the margin before tax with the last known cost, and says how many lines it could not', () => {
    const sale = sell(cableId, 3275);
    const noCost = addProduct('Tubo', 'meter');
    sell(noCost, 1000);

    const report = reports.daily(TODAY);

    // 3.275 m at $5.00 a meter is $16.375, which rounds to 1638 cents.
    expect(report.marginCents).toBe(sale.subtotalCents - 1638);
    expect(report.linesWithoutCost).toBe(1);
  });

  it('lists what ran out and what has stock but is not selling', () => {
    const empty = addProduct('Clavos', 'meter');
    stock.post([{ productId: empty, type: 'opening_balance', quantityMilli: 1000, source: 'import', sourceId: 'C2' }]);
    stock.post([{ productId: empty, type: 'adjustment', quantityMilli: -1000, source: 'adjustment', sourceId: 'A1' }]);
    sell(cableId, 1000);
    const idle = addProduct('Pintura', 'meter');
    stock.post([{ productId: idle, type: 'opening_balance', quantityMilli: 5000, source: 'import', sourceId: 'C3' }]);

    const report = reports.daily(TODAY);

    expect(report.outOfStock.map((row) => row.name)).toEqual(['Clavos']);
    expect(report.notSelling.map((row) => row.name)).toEqual(['Pintura']);
  });

  it('is only for the owner, and refuses a date that is not a real day', () => {
    expect(() => reports.daily('2026-02-30')).toThrow(RangeError);
    expect(() => reports.daily('hoy')).toThrow(RangeError);
    const cashier = auth.createUser('Ana', 'cashier', '5555');
    auth.logout();
    auth.login(cashier.id, '5555');

    expect(() => reports.daily(TODAY)).toThrow(/owner/);
  });
});
