import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lineTotals, quantityOf, saleTotals, taxRateOf } from '@pos-saas/money';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { UserSummary } from '../../shared/auth';
import { backdatedTicketLine, captureDayLabel } from '../../shared/capture-day';
import { AuditLog } from '../audit/audit-log';
import { parseLoginRequest } from '../auth/auth-request';
import { AuthService } from '../auth/auth-service';
import { OwnerGate } from '../auth/owner-gate';
import { UserStore } from '../auth/user-store';
import type { SaleToSave } from '../checkout/sale-recorder';
import { composeTicket, type TicketData } from '../checkout/ticket/ticket';
import { LocalStore } from '../local-store/local-store';
import { SaleStore } from '../local-store/sale-store';
import { DashboardService } from '../reports/dashboard-service';
import { dayText, localDayOf, momentOnDay, parseDay } from '../reports/period';
import { ReportService } from '../reports/report-service';
import { uuidV7 } from '../uuid-v7';
import { CaptureDays, captureDaysFrom } from './capture-days';
import { CashService } from './cash-service';
import { CashSessionStore } from './cash-session-store';

const TENANT = 'tenant-a';
const MS_PER_DAY = 86_400_000;

let directory: string;
let store: LocalStore;
let auth: AuthService;
let cashStore: CashSessionStore;
let cash: CashService;
let sales: SaleStore;
let owner: UserSummary;
let cashier: UserSummary;
let today: string;
let yesterday: string;

function daysBefore(day: string, days: number): string {
  return dayText(parseDay(day) - days * MS_PER_DAY);
}

/** The register has worked for a few days: its first cash session was opened, and cut, three days ago. */
function startedDaysAgo(days: number): void {
  const openedAt = new Date(Date.now() - days * MS_PER_DAY).toISOString();
  store
    .prepare('INSERT INTO cash_session (id, tenant_id, opened_by, opened_at, opening_float_cents, closed_by, closed_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
    .run(uuidV7(), TENANT, owner.id, openedAt, owner.id, openedAt);
}

/** A $116.00 hammer sale in the given session, not saved yet. */
function aSale(sessionId: string, productId: string = uuidV7()): SaleToSave {
  const quantity = quantityOf(2000, 'piece');
  const line = {
    id: uuidV7(),
    productId,
    productName: 'Martillo',
    quantity,
    unitPriceE4: 580_000,
    totals: lineTotals(580_000, quantity, taxRateOf('rate', 1600)),
  };
  const totals = saleTotals([line.totals]);
  return {
    saleId: uuidV7(),
    idempotencyKey: uuidV7(),
    lines: [line],
    subtotalCents: totals.subtotalCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
    cashSessionId: sessionId,
    cashierId: owner.id,
  };
}

function sell(sale: SaleToSave): ReturnType<SaleStore['markCompleted']> {
  sales.savePendingPayment(sale);
  return sales.markCompleted(sale.saleId, [{ method: 'cash', amountCents: sale.totalCents, reference: null }]);
}

function auditActions(): string[] {
  return (store.prepare('SELECT action FROM audit_log ORDER BY rowid').all() as unknown as { action: string }[]).map((row) => row.action);
}

function outbox(type: string): Record<string, unknown>[] {
  return (store.prepare('SELECT payload FROM sync_outbox WHERE type = ? ORDER BY device_seq').all(type) as unknown as { payload: string }[]).map(
    (row) => JSON.parse(row.payload) as Record<string, unknown>,
  );
}

const ANY_COUNT = { counts: {}, cardCountedCents: 0, transferCountedCents: 0, reason: 'Prueba' };

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'backdated-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  auth = new AuthService(new UserStore(store, TENANT), undefined, { captureDays: new CaptureDays(store, TENANT), audit: new AuditLog(store, TENANT) });
  cashStore = new CashSessionStore(store, TENANT);
  cash = new CashService(cashStore, auth, new AuditLog(store, TENANT));
  sales = new SaleStore(store, TENANT);
  owner = auth.setupOwner('Mauricio', '4321');
  auth.login(owner.id, '4321');
  cashier = auth.createUser('Ana', 'cashier', '5555');
  auth.logout();
  today = localDayOf(Date.now());
  yesterday = daysBefore(today, 1);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('the days a session may capture', () => {
  it('offers today first and goes back at most seven days', () => {
    expect(captureDaysFrom('2026-11-18', '2026-01-01')).toEqual([
      '2026-11-18',
      '2026-11-17',
      '2026-11-16',
      '2026-11-15',
      '2026-11-14',
      '2026-11-13',
      '2026-11-12',
      '2026-11-11',
    ]);
  });

  it('never goes before the first cash session, and offers only today when the register never opened one', () => {
    expect(captureDaysFrom('2026-11-18', '2026-11-17')).toEqual(['2026-11-18', '2026-11-17']);
    expect(captureDaysFrom('2026-11-18', '2026-11-18')).toEqual(['2026-11-18']);
    expect(captureDaysFrom('2026-11-18', null)).toEqual(['2026-11-18']);
  });

  it('reads the window from the first cash session of the register', () => {
    expect(new CaptureDays(store, TENANT).allowed()).toEqual([today]);
    startedDaysAgo(3);
    expect(new CaptureDays(store, TENANT).allowed()).toEqual([today, yesterday, daysBefore(today, 2), daysBefore(today, 3)]);
  });
});

describe('signing in to a past day', () => {
  beforeEach(() => startedDaysAgo(3));

  it('lets the owner choose yesterday, and writes it in the audit log', () => {
    expect(auth.login(owner.id, '4321', { day: yesterday })).toEqual({ status: 'ok', user: owner });
    expect(auth.captureDay()).toBe(yesterday);
    expect(auditActions()).toContain('session.backdated_capture');
  });

  it('treats today as a normal sign-in', () => {
    expect(auth.login(cashier.id, '5555', { day: today }).status).toBe('ok');
    expect(auth.captureDay()).toBeNull();
    expect(auditActions()).not.toContain('session.backdated_capture');
  });

  it('asks a cashier for the PIN of an owner, and signs nobody in until it is right', () => {
    expect(auth.login(cashier.id, '5555', { day: yesterday })).toEqual({ status: 'owner_pin_required' });
    expect(auth.currentUser()).toBeNull();
    expect(auth.login(cashier.id, '5555', { day: yesterday, ownerPin: '0000' })).toEqual({ status: 'owner_wrong_pin', attemptsLeft: 4 });
    expect(auth.currentUser()).toBeNull();
    expect(auth.login(cashier.id, '5555', { day: yesterday, ownerPin: '4321' }).status).toBe('ok');
    expect(auth.captureDay()).toBe(yesterday);
  });

  it('refuses a future day, a day older than the window, and a day before the register started', () => {
    for (const day of [daysBefore(today, -1), daysBefore(today, 4), daysBefore(today, 30)]) {
      expect(auth.login(owner.id, '4321', { day })).toEqual({ status: 'day_out_of_range' });
      expect(auth.currentUser()).toBeNull();
    }
  });

  it('forgets the day when the person signs out', () => {
    auth.login(owner.id, '4321', { day: yesterday });
    auth.logout();
    auth.login(owner.id, '4321');
    expect(auth.captureDay()).toBeNull();
  });

  it('reads the day and the owner PIN from the screen, and refuses a malformed day', () => {
    const userId = uuidV7();
    expect(parseLoginRequest({ userId, pin: '5555', capture: { day: '2026-11-17', ownerPin: '4321' } })).toEqual({
      userId,
      pin: '5555',
      capture: { day: '2026-11-17', ownerPin: '4321' },
    });
    expect(parseLoginRequest({ userId, pin: '5555' })).toEqual({ userId, pin: '5555' });
    expect(() => parseLoginRequest({ userId, pin: '5555', capture: { day: '17/11/2026' } })).toThrow(TypeError);
  });
});

describe('a backdated capture', () => {
  let todaySession: string;

  beforeEach(() => {
    startedDaysAgo(3);
    auth.login(owner.id, '4321');
    cash.open(10_000);
    todaySession = cash.openSessionId()!;
    auth.logout();
    auth.login(owner.id, '4321', { day: yesterday });
  });

  it('opens a cash session of its own for its day, next to the drawer of today', () => {
    expect(cash.status().session).toBeNull();
    const opened = cash.open(0);
    expect(opened.status).toBe('opened');
    expect(opened.cash.session?.businessDay).toBe(yesterday);
    expect(cash.openSessionId()).not.toBe(todaySession);
    expect(cashStore.findOpen()?.id).toBe(todaySession);
    expect(auditActions()).toContain('cash_session.opened_backdated');
    expect(outbox('cash_session.opened').at(-1)).toMatchObject({ businessDate: yesterday, openingFloatCents: 0 });
    expect(outbox('cash_session.opened')[0]).not.toHaveProperty('businessDate');
  });

  it('puts its sales on its day at the hour they were rung up, with their stock, and tells the core the day', () => {
    cash.open(0);
    const sale = aSale(cash.openSessionId()!);
    const completed = sell(sale);
    expect(completed.businessDay).toBe(yesterday);
    const row = store.prepare('SELECT occurred_at, business_day, business_at FROM sale WHERE id = ?').get(sale.saleId) as unknown as {
      occurred_at: string;
      business_day: string;
      business_at: string;
    };
    expect(row.business_day).toBe(yesterday);
    expect(localDayOf(Date.parse(row.business_at))).toBe(yesterday);
    expect(Date.parse(row.business_at)).toBe(momentOnDay(Date.parse(row.occurred_at), yesterday));
    const stock = store.prepare('SELECT business_day FROM stock_movement WHERE source_id = ?').get(sale.lines[0]!.id) as unknown as { business_day: string };
    expect(stock.business_day).toBe(yesterday);
    expect(outbox('sale.completed').at(-1)).toMatchObject({ saleId: sale.saleId, businessDate: yesterday });
    expect(sales.findLastCompletedSale()?.businessDay).toBe(yesterday);
  });

  it('leaves the sales of today on today, without a business day', () => {
    auth.logout();
    auth.login(owner.id, '4321');
    const sale = aSale(todaySession);
    expect(sell(sale).businessDay).toBeNull();
    const row = store.prepare('SELECT business_day, business_at FROM sale WHERE id = ?').get(sale.saleId) as unknown as { business_day: null; business_at: null };
    expect(row).toEqual({ business_day: null, business_at: null });
    expect(outbox('sale.completed').at(-1)).not.toHaveProperty('businessDate');
  });

  it('cuts its own session as a supplementary cut of its day, and never touches the drawer of today', () => {
    cash.open(0);
    sell(aSale(cash.openSessionId()!));
    const closed = cash.close({ ...ANY_COUNT, counts: { 10_000: 1, 1_000: 1, 500: 1, 100: 1 } });
    expect(closed).toMatchObject({ status: 'closed', cut: { businessDay: yesterday, isBalanced: true } });
    expect(cashStore.findOpen()?.id).toBe(todaySession);
    expect(auditActions()).toContain('cash_session.closed_backdated');
    expect(outbox('cash_session.closed').at(-1)).toMatchObject({ businessDate: yesterday });
  });

  it('opens another supplementary session when that day was already cut', () => {
    cash.open(0);
    cash.close(ANY_COUNT);
    expect(cash.open(0).status).toBe('opened');
    expect(cash.status().session?.businessDay).toBe(yesterday);
  });

  it('refuses at the database a sale whose day is not the day of its session', () => {
    cash.open(0);
    const sessionId = cash.openSessionId()!;
    const insert = (day: string | null, at: string | null): void => {
      store
        .prepare(
          `INSERT INTO sale (id, tenant_id, idempotency_key, status, subtotal_cents, tax_cents, total_cents, occurred_at, cash_session_id, business_day, business_at)
           VALUES (?, ?, ?, 'pending_payment', 100, 0, 100, ?, ?, ?, ?)`,
        )
        .run(uuidV7(), TENANT, uuidV7(), new Date().toISOString(), sessionId, day, at);
    };
    expect(() => insert(null, null)).toThrow(/captures the day of its cash session/);
    expect(() => insert(today, new Date().toISOString())).toThrow(/captures the day of its cash session/);
    expect(() => insert(yesterday, null)).toThrow(/captures the day of its cash session/);
  });
});

describe('the reports of a backdated sale', () => {
  let dashboard: DashboardService;
  let reports: ReportService;

  beforeEach(() => {
    startedDaysAgo(3);
    auth.login(owner.id, '4321', { day: yesterday });
    cash.open(0);
    sell(aSale(cash.openSessionId()!));
    dashboard = new DashboardService(store, TENANT, new OwnerGate(auth, new AuditLog(store, TENANT)));
    reports = new ReportService(store, TENANT, auth);
  });

  it('count it in the summary, the top sellers and the hours of its day, not of the day it was captured', () => {
    const summaryOf = (date: string) => {
      const result = dashboard.summary({ period: 'day', date, topMetric: 'quantity', topLimit: 10 }, owner);
      if (result.status !== 'ok') {
        throw new Error(result.status);
      }
      return result.summary;
    };
    const onItsDay = summaryOf(yesterday);
    expect(onItsDay.totals).toMatchObject({ salesCount: 1, totalCents: 11_600 });
    expect(onItsDay.topSellers.map((seller) => seller.name)).toEqual(['Martillo']);
    expect(onItsDay.byHour.reduce((sum, hour) => sum + hour.salesCount, 0)).toBe(1);
    expect(summaryOf(today).totals.salesCount).toBe(0);
  });

  it('count it in the income statement of its day', () => {
    const statementOf = (date: string) => {
      const result = dashboard.statement({ period: 'day', date }, owner);
      if (result.status !== 'ok') {
        throw new Error(result.status);
      }
      return result.statement;
    };
    expect(statementOf(yesterday).grossSales.amountCents).toBe(10_000);
    expect(statementOf(today).grossSales.amountCents).toBe(0);
  });

  it('count it in the daily report of its day', () => {
    // The daily report cuts days in the time zone of the process, which is the zone of the register in the store but UTC on
    // CI, so the days are read in that same zone from the moments of the sale.
    const { business_at: businessAt, resolved_at: resolvedAt } = store
      .prepare("SELECT business_at, resolved_at FROM sale WHERE status = 'completed'")
      .get() as unknown as { business_at: string; resolved_at: string };
    const processDayOf = (moment: string) => {
      const at = new Date(moment);
      return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
    };
    expect(reports.daily(processDayOf(businessAt))).toMatchObject({ salesCount: 1, totalCents: 11_600 });
    expect(reports.daily(processDayOf(resolvedAt))).toMatchObject({ salesCount: 0 });
  });
});

describe('the ticket of a backdated sale', () => {
  const ticket: TicketData = {
    businessName: 'Tlapalería',
    folio: 'T1-000002',
    completedAt: '2026-11-18T15:05:30.000Z',
    lines: [{ name: 'Martillo', quantity: quantityOf(1000, 'piece'), unitPriceE4: 1_160_000, totalCents: 11_600 }],
    subtotalCents: 10_000,
    taxGroups: [],
    totalCents: 11_600,
    payments: [{ method: 'cash', amountCents: 11_600, reference: null }],
    changeCents: 0,
    isReprint: false,
  };

  it('prints the day it belongs to under the folio', () => {
    expect(backdatedTicketLine('2026-11-17')).toBe('Captura atrasada del martes 17 de noviembre');
    const texts = composeTicket({ ...ticket, backdatedDay: '2026-11-17' }).map((part) => part.text.trim());
    const line = texts.findIndex((text) => text.startsWith('Captura atrasada'));
    expect(line).toBeGreaterThan(texts.findIndex((text) => text.startsWith('Folio')));
    expect(texts.join(' ')).toContain(captureDayLabel('2026-11-17'));
  });

  it('prints nothing more for a sale of the same day', () => {
    expect(composeTicket(ticket).some((part) => part.text.includes('Captura atrasada'))).toBe(false);
  });
});
