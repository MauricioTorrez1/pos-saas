import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { UserSummary } from '../../shared/auth';
import { DEFAULT_EXPENSE_CONCEPTS, type ExpenseRequest } from '../../shared/expenses';
import type { IncomeStatement } from '../../shared/income-statement';
import { AuditLog } from '../audit/audit-log';
import { AuthService } from '../auth/auth-service';
import { OwnerGate } from '../auth/owner-gate';
import { UserStore } from '../auth/user-store';
import { CashService } from '../cash/cash-service';
import { CashSessionStore } from '../cash/cash-session-store';
import { LocalStore } from '../local-store/local-store';
import { DashboardService } from '../reports/dashboard-service';
import { dayText, localDayOf, parseDay } from '../reports/period';
import { ExpenseBook } from './expense-book';
import { parseExpenseRequest, parseSaveConceptsRequest } from './expenses-ipc';

const TENANT = 'tenant-a';
/** The real clock: the cash movements are stamped with it, and the summary reads them by their moment. */
const NOW = new Date();
const TODAY = localDayOf(NOW.getTime());
const DAY_MS = 86_400_000;
const YESTERDAY = dayText(parseDay(TODAY) - DAY_MS);
const TOMORROW = dayText(parseDay(TODAY) + DAY_MS);

let directory: string;
let store: LocalStore;
let auth: AuthService;
let cash: CashService;
let book: ExpenseBook;
let dashboard: DashboardService;
let owner: UserSummary;
let cashier: UserSummary;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'expenses-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  auth = new AuthService(new UserStore(store, TENANT));
  owner = auth.setupOwner('Mauricio', '4321');
  auth.login(owner.id, '4321');
  cashier = auth.createUser('Ana', 'cashier', '5555');
  const cashStore = new CashSessionStore(store, TENANT);
  cash = new CashService(cashStore, auth);
  const gate = new OwnerGate(auth, new AuditLog(store, TENANT));
  book = new ExpenseBook(store, TENANT, cashStore, gate, new AuditLog(store, TENANT), () => NOW);
  dashboard = new DashboardService(store, TENANT, gate, () => NOW);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function expense(overrides: Partial<ExpenseRequest> = {}): ExpenseRequest {
  return { concept: 'Luz', amountCents: 45_000, day: TODAY, note: null, paidFromDrawer: false, ...overrides };
}

function statementOfToday(): IncomeStatement {
  const result = dashboard.statement({ period: 'day', date: TODAY }, owner);
  if (result.status !== 'ok') {
    throw new Error(`expected a statement, got ${result.status}`);
  }
  return result.statement;
}

function auditActions(): string[] {
  return (store.prepare('SELECT action FROM audit_log ORDER BY rowid').all() as { action: string }[]).map((row) => row.action);
}

describe('recording an expense (ADR 0072)', () => {
  it('writes it down with who did it and leaves it in the audit log', () => {
    const result = book.record(expense({ note: '  recibo de octubre ' }), owner);

    expect(result).toMatchObject({ status: 'recorded', expense: { concept: 'Luz', amountCents: 45_000, day: TODAY, note: 'recibo de octubre', paidFromDrawer: false, recordedBy: 'Mauricio', voided: null } });
    expect(auditActions()).toEqual(['expense.recorded']);
  });

  it('takes a past day for an expense not paid from the drawer, and refuses a future one', () => {
    expect(book.record(expense({ day: YESTERDAY }), owner).status).toBe('recorded');
    expect(book.record(expense({ day: TOMORROW }), owner)).toEqual({ status: 'invalid', message: 'La fecha del gasto no puede ser futura.' });
  });

  it.each([
    ['a zero amount', { amountCents: 0 }],
    ['an amount with decimals', { amountCents: 10.5 }],
    ['more than a million pesos', { amountCents: 100_000_001 }],
    ['a concept that is not on the list', { concept: 'Viaje a Cancún' }],
    ['a day that does not exist', { day: '2026-02-30' }],
    ['a note that is too long', { note: 'x'.repeat(121) }],
  ])('refuses %s with a message for the screen', (_case, overrides) => {
    const result = book.record(expense(overrides), owner);

    expect(result.status).toBe('invalid');
    expect(store.prepare('SELECT count(*) AS total FROM expense').get()).toEqual({ total: 0 });
  });

  it('matches the concept without caring about capitals and keeps the text of the list', () => {
    expect(book.record(expense({ concept: '  internet  Y teléfono ' }), owner)).toMatchObject({ expense: { concept: 'Internet y teléfono' } });
  });

  it('asks a cashier for the PIN of an owner and writes down a wrong one', () => {
    expect(book.record(expense(), cashier)).toEqual({ status: 'authorization_required' });
    expect(book.record(expense({ ownerPin: '0000' }), cashier)).toMatchObject({ status: 'wrong_pin' });
    expect(book.record(expense({ ownerPin: '4321' }), cashier)).toMatchObject({ status: 'recorded', expense: { recordedBy: 'Ana' } });

    expect(auditActions()).toEqual(['expense.denied', 'expense.denied', 'expense.recorded']);
    expect(store.prepare('SELECT authorized_by AS authorizedBy FROM expense').get()).toEqual({ authorizedBy: owner.id });
  });
});

describe('an expense paid from the drawer', () => {
  it('needs an open cash session', () => {
    expect(book.record(expense({ paidFromDrawer: true }), owner)).toEqual({ status: 'no_session' });
  });

  it('is always of today, because the cash leaves now', () => {
    cash.open(100_000);

    expect(book.record(expense({ paidFromDrawer: true, day: YESTERDAY }), owner)).toMatchObject({ status: 'invalid' });
  });

  it('is one cash exit in the cut and one expense in the statement, never two', () => {
    cash.open(100_000);
    // A plain withdrawal to take money to the bank is a cash exit and not an expense.
    cash.recordMovement({ kind: 'out', amountCents: 20_000, reason: 'Depósito al banco' });

    book.record(expense({ paidFromDrawer: true }), owner);

    const status = cash.status();
    expect(status.totals?.cashOutCents).toBe(65_000);
    expect(status.expected?.cashCents).toBe(100_000 - 20_000 - 45_000);
    const movement = store.prepare("SELECT reason, amount_cents AS amountCents FROM cash_movement WHERE reason LIKE 'Gasto:%'").all();
    expect(movement).toEqual([{ reason: 'Gasto: Luz', amountCents: 45_000 }]);

    const statement = statementOfToday();
    expect(statement.operatingExpenses.amountCents).toBe(45_000);
    expect(statement.detail.expensesByConcept).toEqual([{ concept: 'Luz', amountCents: 45_000, count: 1, fromDrawerCents: 45_000 }]);
  });

  it('shows in «Resumen» as part of the exits of the drawer', () => {
    cash.open(100_000);
    cash.recordMovement({ kind: 'out', amountCents: 20_000, reason: 'Depósito al banco' });
    book.record(expense({ paidFromDrawer: true }), owner);

    const result = dashboard.summary({ period: 'day', date: TODAY, topMetric: 'quantity', topLimit: 10 }, owner);

    expect(result.status === 'ok' && result.summary.cashMovements).toEqual({ inCents: 0, outCents: 65_000, drawerExpensesCents: 45_000 });
  });

  it('rolls back the expense when its cash exit fails, so the two never disagree', () => {
    cash.open(100_000);
    store.prepare("CREATE TRIGGER fail_movement BEFORE INSERT ON cash_movement BEGIN SELECT RAISE(ABORT, 'disk full'); END").run();

    expect(() => book.record(expense({ paidFromDrawer: true }), owner)).toThrow('disk full');
    expect(store.prepare('SELECT count(*) AS total FROM expense').get()).toEqual({ total: 0 });
  });
});

describe('voiding an expense', () => {
  it('takes it out of the statement and keeps it in the list with the reason', () => {
    const recorded = book.record(expense(), owner);
    if (recorded.status !== 'recorded') {
      throw new Error('expected an expense');
    }

    expect(book.void({ id: recorded.expense.id, reason: 'Era de otro mes' }, owner)).toEqual({ status: 'voided', returnedToDrawer: false });

    expect(statementOfToday().operatingExpenses.amountCents).toBe(0);
    const list = book.list({ fromDay: TODAY, toDay: TODAY }, owner);
    expect(list.status === 'ok' && list.expenses[0]?.voided).toMatchObject({ by: 'Mauricio', reason: 'Era de otro mes' });
    expect(book.void({ id: recorded.expense.id, reason: 'otra vez' }, owner)).toEqual({ status: 'already_voided' });
    expect(auditActions()).toEqual(['expense.recorded', 'expense.voided']);
  });

  it('puts the cash back while the session that paid it is open, so the cut balances again', () => {
    cash.open(100_000);
    const recorded = book.record(expense({ paidFromDrawer: true }), owner);
    if (recorded.status !== 'recorded') {
      throw new Error('expected an expense');
    }

    expect(book.void({ id: recorded.expense.id, reason: 'Se escribió dos veces' }, owner)).toEqual({ status: 'voided', returnedToDrawer: true });

    expect(cash.status().expected?.cashCents).toBe(100_000);
    expect(cash.status().totals).toMatchObject({ cashInCents: 45_000, cashOutCents: 45_000 });
  });

  it('leaves the cash alone once that session is closed, because the cut was made without it', () => {
    cash.open(100_000);
    const recorded = book.record(expense({ paidFromDrawer: true }), owner);
    if (recorded.status !== 'recorded') {
      throw new Error('expected an expense');
    }
    cash.close({ counts: { 50000: 1, 5000: 1 }, cardCountedCents: 0, transferCountedCents: 0, reason: '' });

    expect(book.void({ id: recorded.expense.id, reason: 'Error' }, owner)).toEqual({ status: 'voided', returnedToDrawer: false });
    expect(store.prepare("SELECT count(*) AS total FROM cash_movement WHERE kind = 'in'").get()).toEqual({ total: 0 });
  });

  it('needs a reason and an expense that exists', () => {
    expect(book.void({ id: 'nope', reason: 'x' }, owner)).toEqual({ status: 'not_found' });
    expect(book.void({ id: 'nope', reason: '  ' }, owner)).toMatchObject({ status: 'invalid' });
  });

  it('cannot be skipped by writing to the database: an expense never changes and is never deleted', () => {
    book.record(expense(), owner);

    expect(() => store.prepare('UPDATE expense SET amount_cents = 1').run()).toThrow('never changes');
    expect(() => store.prepare('DELETE FROM expense').run()).toThrow('never deleted');
  });
});

describe('the list of concepts', () => {
  it('starts with the default one', () => {
    const list = book.list({ fromDay: TODAY, toDay: TODAY }, owner);

    expect(list.status === 'ok' && list.concepts).toEqual(DEFAULT_EXPENSE_CONCEPTS);
  });

  it('is cleaned and saved by the owner, and the expenses keep the text they had', () => {
    book.record(expense(), owner);

    const saved = book.saveConcepts({ concepts: [' CFE ', 'Renta', 'renta', '', 'Sueldos'] }, owner);

    expect(saved).toEqual({ status: 'saved', concepts: ['CFE', 'Renta', 'Sueldos'] });
    expect(book.record(expense({ concept: 'Luz' }), owner).status).toBe('invalid');
    expect(book.record(expense({ concept: 'cfe' }), owner)).toMatchObject({ expense: { concept: 'CFE' } });
    expect(statementOfToday().detail.expensesByConcept.map((line) => line.concept)).toEqual(['CFE', 'Luz']);
    expect(auditActions()).toContain('expense.concepts_changed');
  });

  it('cannot be left empty', () => {
    expect(book.saveConcepts({ concepts: ['  '] }, owner)).toEqual({ status: 'invalid', message: 'Deja al menos un concepto.' });
  });
});

describe('the bridge', () => {
  it('checks the shape of an expense', () => {
    expect(parseExpenseRequest({ concept: 'Luz', amountCents: 100, day: TODAY, note: null, paidFromDrawer: false })).toEqual({
      concept: 'Luz',
      amountCents: 100,
      day: TODAY,
      note: null,
      paidFromDrawer: false,
    });
    expect(() => parseExpenseRequest({ concept: 'Luz', amountCents: '100', day: TODAY, paidFromDrawer: false })).toThrow(TypeError);
    expect(() => parseExpenseRequest({ concept: 'Luz', amountCents: 100, day: TODAY })).toThrow(TypeError);
    expect(() => parseSaveConceptsRequest({ concepts: 'Luz' })).toThrow(TypeError);
  });
});
