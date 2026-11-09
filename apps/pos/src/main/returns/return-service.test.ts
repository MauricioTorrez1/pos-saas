import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lineTotals, quantityOf, saleTotals, taxRateOf, type Unit } from '@pos-saas/money';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { UserSummary } from '../../shared/auth';
import { AuthService } from '../auth/auth-service';
import { UserStore } from '../auth/user-store';
import { CashService } from '../cash/cash-service';
import { CashSessionStore } from '../cash/cash-session-store';
import type { SalePayment, SaleToSave } from '../checkout/sale-recorder';
import { LocalStore } from '../local-store/local-store';
import { SaleStore } from '../local-store/sale-store';
import { uuidV7 } from '../uuid-v7';
import { ReturnService } from './return-service';
import { ReturnStore } from './return-store';

const TENANT = 'tenant-a';
/** The moment the test starts. Sales are stamped with the real clock, so the days are counted from it. */
let START: Date;
const SIXTEEN = taxRateOf('rate', 1600);

let directory: string;
let store: LocalStore;
let auth: AuthService;
let cash: CashService;
let sales: SaleStore;
let returns: ReturnService;
let now: Date;
let owner: UserSummary;
let cashier: UserSummary;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'returns-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  // A minute ahead, so every sale of the test is older than zero seconds and never in the future.
  START = new Date(Date.now() + 60_000);
  now = START;
  auth = new AuthService(new UserStore(store, TENANT));
  cash = new CashService(new CashSessionStore(store, TENANT), auth);
  sales = new SaleStore(store, TENANT);
  returns = new ReturnService(new ReturnStore(store, TENANT), auth, cash, () => now);
  owner = auth.setupOwner('Mauricio', '4321');
  auth.login(owner.id, '4321');
  cashier = auth.createUser('Ana', 'cashier', '5555');
  cash.open(100000);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function line(name: string, milli: number, unit: Unit, unitPriceE4: number): SaleToSave['lines'][number] {
  const quantity = quantityOf(milli, unit);
  return { id: uuidV7(), productId: uuidV7(), productName: name, quantity, unitPriceE4, totals: lineTotals(unitPriceE4, quantity, SIXTEEN) };
}

/** Sells the lines in the open session and pays them with the given parts, which must add up to the total. */
function sell(lines: SaleToSave['lines'], payments: (total: number) => SalePayment[]): { sale: SaleToSave; folio: number } {
  const totals = saleTotals(lines.map((each) => each.totals));
  const sale: SaleToSave = {
    saleId: uuidV7(),
    idempotencyKey: uuidV7(),
    lines,
    subtotalCents: totals.subtotalCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
    cashSessionId: cash.openSessionId()!,
    cashierId: owner.id,
  };
  sales.savePendingPayment(sale);
  const completed = sales.markCompleted(sale.saleId, payments(totals.totalCents));
  return { sale, folio: completed.folio };
}

const CASH_ONLY = (total: number): SalePayment[] => [{ method: 'cash', amountCents: total, reference: null }];
const MIXED = (total: number): SalePayment[] => [
  { method: 'cash', amountCents: total - 4000, reference: null },
  { method: 'transfer', amountCents: 4000, reference: 'SPEI-778812' },
];

function hammerSale(payments = CASH_ONLY): { sale: SaleToSave; folio: number } {
  return sell([line('Martillo', 2000, 'piece', 1_160_000)], payments);
}

function findSale(folio: number) {
  const result = returns.findSale(`T1-${String(folio).padStart(6, '0')}`);
  if (result.status !== 'found') {
    throw new Error('The sale should have been found');
  }
  return result.sale;
}

describe('finding the sale by its folio', () => {
  it('finds it from the folio on the ticket, with or without the register code and zeros', () => {
    const { folio } = hammerSale();

    for (const text of [`T1-${String(folio).padStart(6, '0')}`, 't1-1', '1', ' 000001 '.trim()]) {
      expect(returns.findSale(text)).toMatchObject({ status: 'found', sale: { folio: 'T1-000001' } });
    }
  });

  it('shows what can still come back from each line, and by which means the customer paid', () => {
    const { folio } = hammerSale(MIXED);

    expect(findSale(folio)).toMatchObject({
      totalCents: 23200,
      daysOld: 0,
      violations: [],
      lines: [{ productName: 'Martillo', soldMilli: 2000, returnedMilli: 0, returnableMilli: 2000, lineTotalCents: 23200 }],
      parts: [
        { method: 'cash', remainingCents: 19200 },
        { method: 'transfer', reference: 'SPEI-778812', remainingCents: 4000 },
      ],
    });
  });

  it('says so when there is no such sale, or what was typed is not a folio', () => {
    expect(returns.findSale('999')).toEqual({ status: 'not_found' });
    expect(returns.findSale('abc')).toEqual({ status: 'invalid_folio' });
    expect(returns.findSale('')).toEqual({ status: 'invalid_folio' });
  });

  it('does not find a sale that is pending or cancelled, because nothing was paid', () => {
    const pending = hammerSale().sale;
    sales.savePendingPayment({ ...pending, saleId: uuidV7(), idempotencyKey: uuidV7(), lines: [line('Otro', 1000, 'piece', 100_000)] });

    expect(returns.findSale('2')).toEqual({ status: 'not_found' });
  });
});

describe('a return (RF-019)', () => {
  it('gives back one of two hammers, by the same means, and keeps the sale as it was', () => {
    const { sale, folio } = hammerSale();
    const found = findSale(folio);

    const result = returns.create({ saleId: sale.saleId, lines: [{ saleLineId: found.lines[0]!.saleLineId, quantityMilli: 1000 }], reason: 'No era el modelo' });

    expect(result).toMatchObject({ status: 'returned', totalCents: 11600, refunds: [{ method: 'cash', amountCents: 11600 }] });
    expect(store.prepare('SELECT status, total_cents FROM sale WHERE id = ?').get(sale.saleId)).toEqual({ status: 'completed', total_cents: 23200 });
    expect(findSale(folio).lines[0]).toMatchObject({ returnedMilli: 1000, returnableMilli: 1000, refundedCents: 11600 });
  });

  it('splits a refund of a mixed payment between cash and transfer in the same proportion', () => {
    const { sale, folio } = hammerSale(MIXED);
    const lineId = findSale(folio).lines[0]!.saleLineId;

    const result = returns.create({ saleId: sale.saleId, lines: [{ saleLineId: lineId, quantityMilli: 2000 }], reason: 'Cliente se arrepintió' });

    expect(result).toMatchObject({
      status: 'returned',
      totalCents: 23200,
      refunds: [
        { method: 'cash', reference: null, amountCents: 19200 },
        { method: 'transfer', reference: 'SPEI-778812', amountCents: 4000 },
      ],
    });
  });

  it('never gives back more than was sold, not even in several returns', () => {
    const { sale, folio } = hammerSale();
    const lineId = findSale(folio).lines[0]!.saleLineId;
    returns.create({ saleId: sale.saleId, lines: [{ saleLineId: lineId, quantityMilli: 1000 }], reason: 'Uno' });

    expect(returns.create({ saleId: sale.saleId, lines: [{ saleLineId: lineId, quantityMilli: 2000 }], reason: 'Dos' })).toEqual({ status: 'exceeds_sold' });
    expect(returns.create({ saleId: sale.saleId, lines: [{ saleLineId: lineId, quantityMilli: 1000 }], reason: 'Dos' })).toMatchObject({ status: 'returned', totalCents: 11600 });
    expect(returns.create({ saleId: sale.saleId, lines: [{ saleLineId: lineId, quantityMilli: 1000 }], reason: 'Tres' })).toEqual({ status: 'exceeds_sold' });
    expect(store.prepare('SELECT sum(total_cents) AS total FROM sale_return').get()).toEqual({ total: 23200 });
  });

  it('counts the same line sent twice as one return of the sum', () => {
    const { sale, folio } = hammerSale();
    const lineId = findSale(folio).lines[0]!.saleLineId;

    const result = returns.create({
      saleId: sale.saleId,
      lines: [
        { saleLineId: lineId, quantityMilli: 1500 },
        { saleLineId: lineId, quantityMilli: 1500 },
      ],
      reason: 'x',
    });

    expect(result).toEqual({ status: 'exceeds_sold' });
  });

  it('closes the cent: the parts of a line that comes back in pieces add up to what it cost', () => {
    const { sale, folio } = sell([line('Tornillo', 7000, 'piece', 10_000)], CASH_ONLY);
    const lineId = findSale(folio).lines[0]!.saleLineId;

    const first = returns.create({ saleId: sale.saleId, lines: [{ saleLineId: lineId, quantityMilli: 3000 }], reason: 'a' });
    const second = returns.create({ saleId: sale.saleId, lines: [{ saleLineId: lineId, quantityMilli: 4000 }], reason: 'b' });

    expect(first).toMatchObject({ status: 'returned' });
    expect(second).toMatchObject({ status: 'returned' });
    const total = [first, second].reduce((sum, result) => sum + (result.status === 'returned' ? result.totalCents : 0), 0);
    expect(total).toBe(700);
  });

  it('refuses a fraction of a piece, and an empty return, and an empty reason', () => {
    const { sale, folio } = hammerSale();
    const lineId = findSale(folio).lines[0]!.saleLineId;

    expect(() => returns.create({ saleId: sale.saleId, lines: [{ saleLineId: lineId, quantityMilli: 500 }], reason: 'x' })).toThrow(RangeError);
    expect(returns.create({ saleId: sale.saleId, lines: [], reason: 'x' })).toEqual({ status: 'nothing_selected' });
    expect(returns.create({ saleId: sale.saleId, lines: [{ saleLineId: lineId, quantityMilli: 0 }], reason: 'x' })).toEqual({ status: 'nothing_selected' });
    expect(() => returns.create({ saleId: sale.saleId, lines: [{ saleLineId: lineId, quantityMilli: 1000 }], reason: '   ' })).toThrow(/reason/);
  });

  it('says so when the sale does not exist, or the line is not of that sale', () => {
    const { sale } = hammerSale();

    expect(returns.create({ saleId: uuidV7(), lines: [{ saleLineId: uuidV7(), quantityMilli: 1000 }], reason: 'x' })).toEqual({ status: 'not_found' });
    expect(returns.create({ saleId: sale.saleId, lines: [{ saleLineId: uuidV7(), quantityMilli: 1000 }], reason: 'x' })).toEqual({ status: 'exceeds_sold' });
  });

  it('needs an open register, because the refund comes out of the drawer', () => {
    const { sale, folio } = hammerSale();
    const lineId = findSale(folio).lines[0]!.saleLineId;
    cash.close({ counts: { 100000: 1, 10000: 0 }, cardCountedCents: 0, transferCountedCents: 0, reason: 'x' });

    expect(returns.create({ saleId: sale.saleId, lines: [{ saleLineId: lineId, quantityMilli: 1000 }], reason: 'x' })).toEqual({ status: 'no_session' });
  });

  it('takes the cash refund out of the expected cash of the session where it was paid', () => {
    const { sale, folio } = hammerSale();
    const before = cash.status().expected!.cashCents;
    const lineId = findSale(folio).lines[0]!.saleLineId;

    returns.create({ saleId: sale.saleId, lines: [{ saleLineId: lineId, quantityMilli: 1000 }], reason: 'x' });

    expect(cash.status().expected!.cashCents).toBe(before - 11600);
  });
});

describe('who authorizes it (RF-019)', () => {
  function asCashier(): void {
    auth.logout();
    auth.login(cashier.id, '5555');
  }

  it('is authorized by the owner who asks for it, and keeps their name', () => {
    const { sale, folio } = hammerSale();
    const lineId = findSale(folio).lines[0]!.saleLineId;

    returns.create({ saleId: sale.saleId, lines: [{ saleLineId: lineId, quantityMilli: 1000 }], reason: 'x' });

    expect(store.prepare('SELECT requested_by, authorized_by FROM sale_return').get()).toEqual({ requested_by: owner.id, authorized_by: owner.id });
  });

  it('needs the PIN of an owner when a cashier asks, and records both names', () => {
    const { sale, folio } = hammerSale();
    const lineId = findSale(folio).lines[0]!.saleLineId;
    asCashier();
    const request = { saleId: sale.saleId, lines: [{ saleLineId: lineId, quantityMilli: 1000 }], reason: 'x' };

    expect(returns.create(request)).toEqual({ status: 'authorization_required' });
    expect(returns.create({ ...request, ownerPin: '0000' })).toMatchObject({ status: 'wrong_pin' });
    expect(store.prepare('SELECT id FROM sale_return').all()).toEqual([]);
    expect(returns.create({ ...request, ownerPin: '4321' }).status).toBe('returned');
    expect(store.prepare('SELECT requested_by, authorized_by FROM sale_return').get()).toEqual({ requested_by: cashier.id, authorized_by: owner.id });
  });

  it('does not take the PIN of a cashier for an owner', () => {
    const { sale, folio } = hammerSale();
    const lineId = findSale(folio).lines[0]!.saleLineId;
    asCashier();

    expect(returns.create({ saleId: sale.saleId, lines: [{ saleLineId: lineId, quantityMilli: 1000 }], reason: 'x', ownerPin: '5555' })).toMatchObject({ status: 'wrong_pin' });
  });
});

describe('the rules that refuse a return by default (RF-019)', () => {
  it('accepts a ticket from 10 days ago', () => {
    const { sale, folio } = hammerSale();
    const lineId = findSale(folio).lines[0]!.saleLineId;
    now = new Date(START.getTime() + 10 * 86_400_000);

    expect(returns.create({ saleId: sale.saleId, lines: [{ saleLineId: lineId, quantityMilli: 1000 }], reason: 'x' }).status).toBe('returned');
  });

  it('refuses one from more than 30 days ago, unless the owner overrides it', () => {
    const { sale, folio } = hammerSale();
    const lineId = findSale(folio).lines[0]!.saleLineId;
    now = new Date(START.getTime() + 31 * 86_400_000);
    const request = { saleId: sale.saleId, lines: [{ saleLineId: lineId, quantityMilli: 1000 }], reason: 'x' };

    expect(returns.create(request)).toEqual({ status: 'needs_override', violations: ['older_than_window'] });
    expect(findSale(folio).violations).toEqual(['older_than_window']);
    expect(returns.create({ ...request, override: true }).status).toBe('returned');
  });

  it('refuses cable that was cut to measure, unless the owner overrides it', () => {
    const { sale, folio } = sell([line('Cable THW', 3275, 'meter', 125_000)], CASH_ONLY);
    const lineId = findSale(folio).lines[0]!.saleLineId;
    const request = { saleId: sale.saleId, lines: [{ saleLineId: lineId, quantityMilli: 1000 }], reason: 'x' };

    expect(returns.create(request)).toEqual({ status: 'needs_override', violations: ['measured_product'] });
    expect(returns.create({ ...request, override: true })).toMatchObject({ status: 'returned', totalCents: 1250 });
  });

  it('does not let a cashier override a rule without the PIN of an owner', () => {
    const { sale, folio } = sell([line('Cable THW', 3275, 'meter', 125_000)], CASH_ONLY);
    const lineId = findSale(folio).lines[0]!.saleLineId;
    auth.logout();
    auth.login(cashier.id, '5555');

    expect(returns.create({ saleId: sale.saleId, lines: [{ saleLineId: lineId, quantityMilli: 1000 }], reason: 'x', override: true })).toEqual({ status: 'authorization_required' });
  });

  it('judges only what comes back: a hammer from a sale that also has cable is a normal return', () => {
    const { sale, folio } = sell([line('Cable THW', 3275, 'meter', 125_000), line('Martillo', 1000, 'piece', 1_000_000)], CASH_ONLY);
    const hammer = findSale(folio).lines[1]!.saleLineId;

    expect(returns.create({ saleId: sale.saleId, lines: [{ saleLineId: hammer, quantityMilli: 1000 }], reason: 'x' }).status).toBe('returned');
  });
});

describe('the database refuses what the rules forbid', () => {
  it('never changes or deletes a return, its lines, or its refunds', () => {
    const { sale, folio } = hammerSale();
    const lineId = findSale(folio).lines[0]!.saleLineId;
    returns.create({ saleId: sale.saleId, lines: [{ saleLineId: lineId, quantityMilli: 1000 }], reason: 'x' });
    const run = (sql: string): void => {
      store.transaction((c) => {
        c.exec(sql);
      });
    };

    expect(() => run("UPDATE sale_return SET reason = 'y'")).toThrow('never changes');
    expect(() => run('DELETE FROM sale_return')).toThrow('never deleted');
    expect(() => run('UPDATE sale_return_line SET quantity_milli = 1')).toThrow('never changes');
    expect(() => run('DELETE FROM sale_return_line')).toThrow('never deleted');
    expect(() => run('UPDATE refund_payment SET amount_cents = 1')).toThrow('never changes');
    expect(() => run('DELETE FROM refund_payment')).toThrow('never deleted');
  });
});
