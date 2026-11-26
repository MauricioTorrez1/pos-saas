import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lineTotals, quantityOf, saleTotals, taxRateOf } from '@pos-saas/money';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { UserSummary } from '../../shared/auth';
import { AuditLog } from '../audit/audit-log';
import { AuthService } from '../auth/auth-service';
import { UserStore } from '../auth/user-store';
import type { SaleToSave } from '../checkout/sale-recorder';
import { LocalStore } from '../local-store/local-store';
import { MIGRATIONS } from '../local-store/migrations';
import { SaleStore } from '../local-store/sale-store';
import { dayText, localDayOf, parseDay } from '../reports/period';
import { uuidV7 } from '../uuid-v7';
import { CaptureDays } from './capture-days';
import { CashService } from './cash-service';
import { CashSessionStore } from './cash-session-store';

const TENANT = 'tenant-a';
const MS_PER_DAY = 86_400_000;
const NO_COUNT = { counts: {}, cardCountedCents: 0, transferCountedCents: 0, reason: 'Prueba' };

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

/**
 * A cash session that was opened some days ago and left without its cut, as «No hacer corte y salir» leaves it (E1-54).
 *
 * @returns its id
 */
function leftOpenDaysAgo(days: number, openedBy: UserSummary, floatCents: number): string {
  const id = uuidV7();
  store
    .prepare('INSERT INTO cash_session (id, tenant_id, opened_by, opened_at, opening_float_cents) VALUES (?, ?, ?, ?, ?)')
    .run(id, TENANT, openedBy.id, new Date(Date.now() - days * MS_PER_DAY).toISOString(), floatCents);
  return id;
}

/** A $116.00 hammer sale, not saved yet, rung up by the person signed in. */
function aSale(sessionId: string): SaleToSave {
  const quantity = quantityOf(2000, 'piece');
  const line = { id: uuidV7(), productId: uuidV7(), productName: 'Martillo', quantity, unitPriceE4: 580_000, totals: lineTotals(580_000, quantity, taxRateOf('rate', 1600)) };
  const totals = saleTotals([line.totals]);
  return {
    saleId: uuidV7(),
    idempotencyKey: uuidV7(),
    lines: [line],
    subtotalCents: totals.subtotalCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
    cashSessionId: sessionId,
    cashierId: auth.currentUser()!.id,
  };
}

function sell(sale: SaleToSave): ReturnType<SaleStore['markCompleted']> {
  sales.savePendingPayment(sale);
  return sales.markCompleted(sale.saleId, [{ method: 'cash', amountCents: sale.totalCents, reference: null }]);
}

function sessionCount(): number {
  return (store.prepare('SELECT count(*) AS total FROM cash_session').get() as unknown as { total: number }).total;
}

function audit(action: string): string[] {
  return (store.prepare('SELECT detail FROM audit_log WHERE action = ? ORDER BY rowid').all(action) as unknown as { detail: string }[]).map((row) => row.detail);
}

function saleRow(saleId: string): { business_day: string | null; cashier_id: string; cash_session_id: string } {
  return store.prepare('SELECT business_day, cashier_id, cash_session_id FROM sale WHERE id = ?').get(saleId) as unknown as {
    business_day: string | null;
    cashier_id: string;
    cash_session_id: string;
  };
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'resume-day-'));
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

describe('a past day left without its cut', () => {
  let unfinished: string;

  beforeEach(() => {
    unfinished = leftOpenDaysAgo(1, cashier, 50_000);
  });

  it('is listed at the sign-in with who opened it and its float', () => {
    expect(auth.pastCaptureDays()).toEqual([
      { day: yesterday, unfinished: { sessionId: unfinished, openedBy: 'Ana', openedAt: expect.any(String), openingFloatCents: 50_000 }, cutCount: 0 },
    ]);
  });

  it('is never the drawer of today: signing in to today opens a new session', () => {
    auth.login(owner.id, '4321');
    expect(cash.status().session).toBeNull();
    expect(cash.open(10_000).status).toBe('opened');
    const todaySession = cash.openSessionId()!;
    expect(todaySession).not.toBe(unfinished);
    const sale = aSale(todaySession);
    expect(sell(sale).businessDay).toBeNull();
    expect(cashStore.totals(cashStore.findOpen(yesterday)!).cashSalesCents).toBe(0);
  });

  it('is resumed by signing in to its day: the same session and float, no new session, and the audit log says so', () => {
    const before = sessionCount();
    expect(auth.login(cashier.id, '5555', { day: yesterday, ownerPin: '4321' }).status).toBe('ok');
    const status = cash.status();
    expect(status.session).toMatchObject({ id: unfinished, openingFloatCents: 50_000, openedBy: 'Ana', isSupplementary: false, sessionDay: yesterday });
    expect(cash.open(0).status).toBe('already_open');
    expect(sessionCount()).toBe(before);
    expect(audit('cash_session.resumed')).toEqual([expect.stringContaining('Ana retomó la caja sin corte')]);
    expect(audit('cash_session.resumed')[0]).toContain('$500.00');
  });

  it('puts the sales added on its day, under the name of who rang them up', () => {
    auth.login(owner.id, '4321', { day: yesterday });
    const sale = aSale(cash.openSessionId()!);
    expect(sell(sale).businessDay).toBe(yesterday);
    expect(saleRow(sale.saleId)).toEqual({ business_day: yesterday, cashier_id: owner.id, cash_session_id: unfinished });
  });

  it('finishes with the cut of that same session', () => {
    auth.login(owner.id, '4321', { day: yesterday });
    sell(aSale(cash.openSessionId()!));
    const closed = cash.close({ ...NO_COUNT, counts: { 50_000: 1, 10_000: 1, 1_000: 1, 500: 1, 100: 1 } });
    expect(closed).toMatchObject({ status: 'closed', cut: { resumedDay: yesterday, businessDay: null, amends: null, isBalanced: true } });
    const cut = store.prepare('SELECT session_id FROM cash_cut').get() as unknown as { session_id: string };
    expect(cut.session_id).toBe(unfinished);
    expect(audit('cash_session.closed_resumed')).toHaveLength(1);
    expect(auth.pastCaptureDays()).toEqual([{ day: yesterday, unfinished: null, cutCount: 1 }]);
  });

  it('is offered even when it is older than the window, because it still needs its cut', () => {
    const old = leftOpenDaysAgo(10, owner, 0);
    const oldDay = daysBefore(today, 10);
    expect(auth.captureDayOptions()).toContain(oldDay);
    expect(auth.login(owner.id, '4321', { day: oldDay }).status).toBe('ok');
    expect(cash.openSessionId()).toBe(old);
  });
});

describe('a past day that was already cut', () => {
  let originalCut: unknown;

  beforeEach(() => {
    leftOpenDaysAgo(3, owner, 0);
    auth.login(owner.id, '4321', { day: yesterday });
    cash.open(20_000);
    sell(aSale(cash.openSessionId()!));
    cash.close({ ...NO_COUNT, counts: { 20_000: 1, 10_000: 1, 1_000: 1, 500: 1, 100: 1 } });
    auth.logout();
    originalCut = store.prepare('SELECT * FROM cash_cut').get();
  });

  it('is refused until the person agrees to a supplementary capture, and signs nobody in', () => {
    expect(auth.pastCaptureDays().find(({ day }) => day === yesterday)).toEqual({ day: yesterday, unfinished: null, cutCount: 1 });
    expect(auth.login(owner.id, '4321', { day: yesterday })).toEqual({ status: 'day_already_cut' });
    expect(auth.currentUser()).toBeNull();
    expect(auth.login(owner.id, '4321', { day: yesterday, supplementary: true }).status).toBe('ok');
    expect(audit('session.backdated_capture').at(-1)).toContain('captura suplementaria');
  });

  it('adds a supplementary capture tied to that cut, whose report amends the day and never edits the original', () => {
    auth.login(owner.id, '4321', { day: yesterday, supplementary: true });
    expect(cash.status().session).toBeNull();
    cash.open(0);
    expect(cash.status().session).toMatchObject({ isSupplementary: true, businessDay: yesterday });
    sell(aSale(cash.openSessionId()!));
    const closed = cash.close({ ...NO_COUNT, counts: { 10_000: 1, 1_000: 1, 500: 1, 100: 1 } });
    if (closed.status !== 'closed') {
      throw new Error(closed.status);
    }
    const { id: cutId } = originalCut as { id: string };
    expect(closed.cut.amends).toMatchObject({
      cutId,
      cutBy: 'Mauricio',
      original: { expected: { cashCents: 31_600 } },
      combined: { expected: { cashCents: 43_200 }, counted: { cashCents: 43_200 } },
    });
    expect(store.prepare('SELECT * FROM cash_cut WHERE id = ?').get(cutId)).toEqual(originalCut);
    const supplementary = store.prepare('SELECT amends_cut_id FROM cash_session WHERE business_day = ? ORDER BY rowid DESC').get(yesterday) as unknown as { amends_cut_id: string };
    expect(supplementary.amends_cut_id).toBe(cutId);
  });
});

describe('one resumed session at a time', () => {
  let older: string;
  let newer: string;

  beforeEach(() => {
    older = leftOpenDaysAgo(2, cashier, 30_000);
    newer = leftOpenDaysAgo(1, owner, 40_000);
  });

  it('works only on the session of the day chosen, and leaves the other past day and today untouched', () => {
    auth.login(owner.id, '4321', { day: daysBefore(today, 2) });
    expect(cash.openSessionId()).toBe(older);
    expect(cash.open(0).status).toBe('already_open');
    sell(aSale(cash.openSessionId()!));
    expect(cashStore.totals(cashStore.findOpen(yesterday)!).cashSalesCents).toBe(0);
    expect(cashStore.findOpen(yesterday)?.id).toBe(newer);
    expect(cashStore.findOpen()).toBeNull();
  });

  it('switches day only by signing out and in again', () => {
    auth.login(owner.id, '4321', { day: daysBefore(today, 2) });
    auth.logout();
    auth.login(owner.id, '4321', { day: yesterday });
    expect(cash.openSessionId()).toBe(newer);
  });

  it('is kept by the database: two open sessions of today kind on the same day are refused', () => {
    expect(() => leftOpenDaysAgo(1, owner, 0)).toThrow(/UNIQUE/);
  });

  it('never lets the day of a session change', () => {
    expect(() => store.prepare('UPDATE cash_session SET session_day = ? WHERE id = ?').run(today, older)).toThrow(/never change/);
  });
});

describe('the sessions written before E1-61', () => {
  it('get their day when the register updates: the open ones from when they opened or what they capture', () => {
    store.close();
    const path = join(directory, 'old.db');
    const oldStore = LocalStore.open({ path, appVersion: '1.0.0', migrations: MIGRATIONS.slice(0, 24) });
    const users = new UserStore(oldStore, TENANT);
    const ownerOfOld = new AuthService(users).setupOwner('Mauricio', '4321');
    const insert = oldStore.prepare('INSERT INTO cash_session (id, tenant_id, opened_by, opened_at, opening_float_cents, business_day) VALUES (?, ?, ?, ?, 0, ?)');
    const live = uuidV7();
    const backdated = uuidV7();
    insert.run(live, TENANT, ownerOfOld.id, new Date(Date.now() - MS_PER_DAY).toISOString(), null);
    insert.run(backdated, TENANT, ownerOfOld.id, new Date().toISOString(), daysBefore(today, 3));
    oldStore.close();

    store = LocalStore.open({ path, appVersion: '1.0.1' });
    const days = store.prepare('SELECT id, session_day FROM cash_session ORDER BY session_day').all() as unknown as { id: string; session_day: string }[];
    expect(days).toEqual([
      { id: backdated, session_day: daysBefore(today, 3) },
      { id: live, session_day: yesterday },
    ]);
  });
});
