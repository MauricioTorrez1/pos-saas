import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lineTotals, quantityOf, saleTotals, taxRateOf } from '@pos-saas/money';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_WITHDRAWAL_LIMIT_CENTS } from '../../shared/cash';
import type { UserSummary } from '../../shared/auth';
import { AuthService } from '../auth/auth-service';
import { UserStore } from '../auth/user-store';
import type { SalePayment, SaleToSave } from '../checkout/sale-recorder';
import { LocalStore } from '../local-store/local-store';
import { SaleStore } from '../local-store/sale-store';
import { uuidV7 } from '../uuid-v7';
import { CashService } from './cash-service';
import { CashSessionStore } from './cash-session-store';

const TENANT = 'tenant-a';

let directory: string;
let store: LocalStore;
let auth: AuthService;
let cash: CashService;
let sales: SaleStore;
let owner: UserSummary;
let cashier: UserSummary;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'cash-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  auth = new AuthService(new UserStore(store, TENANT));
  cash = new CashService(new CashSessionStore(store, TENANT), auth);
  sales = new SaleStore(store, TENANT);
  owner = auth.setupOwner('Mauricio', '4321');
  auth.login(owner.id, '4321');
  cashier = auth.createUser('Ana', 'cashier', '5555');
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

/** A $100.00 hammer sale in the given session, not saved yet. */
function aSale(sessionId: string): SaleToSave {
  const quantity = quantityOf(1000, 'piece');
  const line = {
    id: uuidV7(),
    productId: uuidV7(),
    productName: 'Martillo',
    quantity,
    unitPriceE4: 1_000_000,
    totals: lineTotals(1_000_000, quantity, taxRateOf('rate', 1600)),
  };
  const totals = saleTotals([line.totals]);
  const sale: SaleToSave = {
    saleId: uuidV7(),
    idempotencyKey: uuidV7(),
    lines: [line],
    subtotalCents: totals.subtotalCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
    cashSessionId: sessionId,
    cashierId: owner.id,
  };
  return sale;
}

/** Sells a $100.00 hammer in the open session and pays it with the given parts. */
function sell(payments: readonly SalePayment[], sessionId = cash.openSessionId()!): SaleToSave {
  const sale = aSale(sessionId);
  sales.savePendingPayment(sale);
  sales.markCompleted(sale.saleId, payments);
  return sale;
}

const CASH_100: SalePayment = { method: 'cash', amountCents: 10000, reference: null };

describe('opening the register (RF-024)', () => {
  it('starts closed, and cannot sell', () => {
    expect(cash.status()).toMatchObject({ session: null, totals: null, expected: null, shouldWithdraw: false });
    expect(cash.openSessionId()).toBeNull();
  });

  it('opens with a float, in the name of who opened it', () => {
    const result = cash.open(50000);

    expect(result.status).toBe('opened');
    expect(cash.status()).toMatchObject({
      session: { openedBy: 'Mauricio', openingFloatCents: 50000 },
      expected: { cashCents: 50000 },
    });
  });

  it('accepts a float of zero', () => {
    expect(cash.open(0).status).toBe('opened');
  });

  it('keeps a single session open, so a second opening changes nothing', () => {
    cash.open(50000);

    const second = cash.open(99999);

    expect(second.status).toBe('already_open');
    expect(cash.status().session?.openingFloatCents).toBe(50000);
  });

  it.each([[-1], [1.5], [Number.NaN]])('refuses a float of %s', (floatCents) => {
    expect(() => cash.open(floatCents)).toThrow(RangeError);
  });

  it('needs somebody signed in', () => {
    auth.logout();

    expect(() => cash.open(0)).toThrow(/Sign in/);
  });
});

describe('the cash that is expected (RF-025)', () => {
  it('adds the cash sales, and leaves out the card and the transfers', () => {
    cash.open(50000);
    sell([CASH_100]);
    sell([{ method: 'card_manual', amountCents: 10000, reference: 'A48291' }]);
    sell([{ method: 'transfer', amountCents: 10000, reference: 'SPEI-1' }]);

    expect(cash.status()).toMatchObject({
      totals: { cashSalesCents: 10000, cardSalesCents: 10000, transferSalesCents: 10000 },
      expected: { cashCents: 60000, cardCents: 10000, transferCents: 10000 },
    });
  });

  it('counts the cash part of a mixed payment, and not the rest', () => {
    cash.open(0);
    sell([
      { method: 'cash', amountCents: 6000, reference: null },
      { method: 'transfer', amountCents: 4000, reference: 'SPEI-1' },
    ]);

    expect(cash.status().expected).toMatchObject({ cashCents: 6000, transferCents: 4000 });
  });

  it('does not count a sale that is pending or was cancelled', () => {
    cash.open(0);
    const session = cash.openSessionId()!;
    sell([CASH_100]);
    sales.savePendingPayment(aSale(session));
    const cancelled = aSale(session);
    sales.savePendingPayment(cancelled);
    sales.cancel(cancelled.saleId);

    expect(cash.status().expected?.cashCents).toBe(10000);
  });

  it('goes down with an exit and up with an entry, each with its reason', () => {
    cash.open(50000);

    cash.recordMovement({ kind: 'out', amountCents: 35000, reason: 'Pago a proveedor de tornillos' });
    cash.recordMovement({ kind: 'in', amountCents: 10000, reason: 'Cambio que trajo el dueño' });

    expect(cash.status().expected?.cashCents).toBe(25000);
  });

  it('refuses a movement without a reason, or without an amount', () => {
    cash.open(0);

    expect(() => cash.recordMovement({ kind: 'out', amountCents: 100, reason: '   ' })).toThrow(RangeError);
    expect(() => cash.recordMovement({ kind: 'out', amountCents: 0, reason: 'x' })).toThrow(RangeError);
  });

  it('says so when the register is closed', () => {
    expect(cash.recordMovement({ kind: 'in', amountCents: 100, reason: 'x' })).toEqual({ status: 'no_session' });
  });

  it('keeps the name of who made the movement', () => {
    cash.open(0);
    cash.recordMovement({ kind: 'in', amountCents: 100, reason: 'Fondo extra' });

    const row = store.prepare('SELECT recorded_by, authorized_by FROM cash_movement').get() as Record<string, unknown>;

    expect(row).toEqual({ recorded_by: owner.id, authorized_by: null });
  });
});

describe('who can take cash out (RF-025)', () => {
  beforeEach(() => {
    cash.open(50000);
    auth.logout();
    auth.login(cashier.id, '5555');
  });

  it('asks a cashier for the PIN of an owner, and records who approved it', () => {
    expect(cash.recordMovement({ kind: 'out', amountCents: 1000, reason: 'Gas' })).toEqual({ status: 'authorization_required' });

    const result = cash.recordMovement({ kind: 'out', amountCents: 1000, reason: 'Gas', ownerPin: '4321' });

    expect(result.status).toBe('recorded');
    expect(store.prepare('SELECT recorded_by, authorized_by FROM cash_movement').get()).toEqual({
      recorded_by: cashier.id,
      authorized_by: owner.id,
    });
  });

  it('refuses a wrong PIN, and takes nothing out', () => {
    const result = cash.recordMovement({ kind: 'out', amountCents: 1000, reason: 'Gas', ownerPin: '0000' });

    expect(result).toMatchObject({ status: 'wrong_pin' });
    expect(cash.status().expected?.cashCents).toBe(50000);
  });

  it('does not ask for a PIN to put cash in', () => {
    expect(cash.recordMovement({ kind: 'in', amountCents: 1000, reason: 'Cambio' }).status).toBe('recorded');
  });
});

describe('the warning to withdraw cash (RF-026)', () => {
  it('uses $5,000 until the owner picks another limit', () => {
    cash.open(0);

    expect(cash.status().withdrawalLimitCents).toBe(DEFAULT_WITHDRAWAL_LIMIT_CENTS);
  });

  it('warns above the limit, and goes quiet when an exit brings the cash down, without ever stopping a sale', () => {
    cash.open(DEFAULT_WITHDRAWAL_LIMIT_CENTS);
    expect(cash.status().shouldWithdraw).toBe(false);

    sell([CASH_100]);
    expect(cash.status().shouldWithdraw).toBe(true);
    cash.recordMovement({ kind: 'out', amountCents: 10000, reason: 'Retiro parcial' });

    expect(cash.status().shouldWithdraw).toBe(false);
    expect(() => sell([CASH_100])).not.toThrow();
  });

  it('lets the owner change the limit, and keeps it after a restart', () => {
    cash.open(0);

    cash.setWithdrawalLimit(2_000_000);
    store.close();
    store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
    cash = new CashService(new CashSessionStore(store, TENANT), auth);

    expect(cash.status().withdrawalLimitCents).toBe(2_000_000);
  });

  it('does not let a cashier change it', () => {
    auth.logout();
    auth.login(cashier.id, '5555');

    expect(() => cash.setWithdrawalLimit(1)).toThrow(/owner/);
  });
});

describe('the cut (RF-027)', () => {
  const NOTHING = { cardCountedCents: 0, transferCountedCents: 0, reason: '' };

  function openWithOneCashSale(): void {
    cash.open(50000);
    sell([CASH_100]);
  }

  it('closes the register when what was counted matches, and needs no reason', () => {
    openWithOneCashSale();

    const result = cash.close({ ...NOTHING, counts: { 50000: 1, 10000: 1 } });

    expect(result).toMatchObject({ status: 'closed', cut: { isBalanced: true, reason: null, cutBy: 'Mauricio' } });
    expect(cash.status().session).toBeNull();
  });

  it('shows the difference of each form of payment', () => {
    cash.open(0);
    sell([CASH_100]);
    sell([{ method: 'card_manual', amountCents: 10000, reference: 'A1' }]);
    sell([{ method: 'transfer', amountCents: 10000, reference: 'S1' }]);

    const result = cash.close({ counts: { 10000: 1 }, cardCountedCents: 9000, transferCountedCents: 10000, reason: 'Un voucher perdido' });

    expect(result).toMatchObject({
      status: 'closed',
      cut: {
        cash: { differenceCents: 0 },
        card: { expectedCents: 10000, countedCents: 9000, differenceCents: -1000 },
        transfer: { differenceCents: 0 },
        isBalanced: false,
        reason: 'Un voucher perdido',
      },
    });
  });

  it('asks for a reason when it does not balance, and closes nothing until it has one', () => {
    openWithOneCashSale();

    const result = cash.close({ ...NOTHING, counts: { 50000: 1, 2000: 2 } });

    expect(result).toMatchObject({ status: 'reason_required', comparison: { cash: { differenceCents: -6000 } } });
    expect(cash.status().session).not.toBeNull();
    expect(store.prepare('SELECT id FROM cash_cut').all()).toEqual([]);
  });

  it('refuses to close while a sale is waiting for its answer, because its payment is not final', () => {
    openWithOneCashSale();
    sales.savePendingPayment(aSale(cash.openSessionId()!));

    expect(cash.close({ ...NOTHING, counts: {} })).toEqual({ status: 'pending_sales', count: 1 });
  });

  it('saves what was counted, bill by bill, and who made the cut', () => {
    openWithOneCashSale();

    cash.close({ ...NOTHING, counts: { 50000: 1, 10000: 1 } });

    expect(store.prepare('SELECT cut_by, expected_cash_cents, counted_cash_cents, denominations FROM cash_cut').get()).toEqual({
      cut_by: owner.id,
      expected_cash_cents: 60000,
      counted_cash_cents: 60000,
      denominations: '{"10000":1,"50000":1}',
    });
  });

  it('lets a new session open after the cut, with its own totals', () => {
    openWithOneCashSale();
    cash.close({ ...NOTHING, counts: { 50000: 1, 10000: 1 } });

    cash.open(20000);

    expect(cash.status().expected?.cashCents).toBe(20000);
  });

  it('says so when there is nothing to close, and refuses a count that is not a bill or a coin', () => {
    expect(cash.close({ ...NOTHING, counts: {} })).toEqual({ status: 'no_session' });
    cash.open(0);
    expect(() => cash.close({ ...NOTHING, counts: { 300: 1 } })).toThrow(RangeError);
  });

  it('keeps the closed session and its cut from changing, in the database too', () => {
    openWithOneCashSale();
    cash.close({ ...NOTHING, counts: { 50000: 1, 10000: 1 } });

    expect(() => store.transaction((c) => c.exec("UPDATE cash_cut SET reason = 'x'"))).toThrow('never changes');
    expect(() => store.transaction((c) => c.exec("UPDATE cash_session SET closed_at = NULL"))).toThrow('never changes');
    expect(() => store.transaction((c) => c.exec('DELETE FROM cash_session'))).toThrow('never deleted');
  });

  it('refuses in the database a cut that does not balance and has no reason', () => {
    cash.open(0);
    const session = cash.openSessionId()!;

    expect(() =>
      store.transaction((c) =>
        c
          .prepare(
            `INSERT INTO cash_cut (id, tenant_id, session_id, cut_by, cut_at, expected_cash_cents, counted_cash_cents,
               expected_card_cents, counted_card_cents, expected_transfer_cents, counted_transfer_cents, denominations)
             VALUES (?, ?, ?, ?, ?, 100, 0, 0, 0, 0, 0, '{}')`,
          )
          .run(uuidV7(), TENANT, session, owner.id, '2026-11-08T00:00:00.000Z'),
      ),
    ).toThrow('needs its reason');
  });
});

describe('the database refuses what the rules forbid', () => {
  it('refuses a second open session and a sale in a closed one', () => {
    cash.open(0);
    const session = cash.openSessionId()!;
    expect(() =>
      store.transaction((c) => {
        c.prepare('INSERT INTO cash_session (id, tenant_id, opened_by, opened_at, opening_float_cents) VALUES (?, ?, ?, ?, 0)').run(
          uuidV7(),
          TENANT,
          owner.id,
          '2026-11-08T00:00:00.000Z',
        );
      }),
    ).toThrow(/UNIQUE/);

    cash.close({ counts: {}, cardCountedCents: 0, transferCountedCents: 0, reason: '' });

    expect(() => sell([CASH_100], session)).toThrow('open cash session');
  });

  it('refuses a movement in a closed session, and one that is neither an entry nor an exit', () => {
    cash.open(0);
    const session = cash.openSessionId()!;
    const insert = (kind: string): void => {
      store.transaction((c) => {
        c.prepare(
          `INSERT INTO cash_movement (id, tenant_id, session_id, kind, amount_cents, reason, recorded_by, recorded_at)
           VALUES (?, ?, ?, ?, 100, 'x', ?, '2026-11-08T00:00:00.000Z')`,
        ).run(uuidV7(), TENANT, session, kind, owner.id);
      });
    };

    expect(() => insert('gift')).toThrow('entry or an exit');
    cash.close({ counts: {}, cardCountedCents: 0, transferCountedCents: 0, reason: '' });
    expect(() => insert('in')).toThrow('open cash session');
  });
});
