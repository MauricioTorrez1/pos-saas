import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lineTotals, quantityOf, saleTotals, taxRateOf } from '@pos-saas/money';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFakeHardware } from '../hardware/fakes/fake-hardware';
import { SaleCheckout } from '../checkout/sale-checkout';
import { SaleAlreadyCompletedError, type CheckoutPayment, type CompletedSale, type SaleLineToSave, type SaleToSave } from '../checkout/sale-recorder';
import { InvalidSaleTransitionError } from '../checkout/sale-state-machine';
import { uuidV7 } from '../uuid-v7';
import { LocalStore } from './local-store';
import { SaleNotFoundError, SaleStore } from './sale-store';

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';
const SIXTEEN_PERCENT = taxRateOf('rate', 1600);

let directory: string;
let databasePath: string;
let store: LocalStore;
let sales: SaleStore;

function openStore(): void {
  store = LocalStore.open({ path: databasePath, appVersion: '1.0.0' });
  sales = new SaleStore(store, TENANT);
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'sale-store-'));
  databasePath = join(directory, 'pos.db');
  openStore();
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function cableLine(): SaleLineToSave {
  const quantity = quantityOf(3275, 'meter');
  return {
    id: uuidV7(),
    productId: uuidV7(),
    productName: 'Cable THW',
    quantity,
    unitPriceE4: 125_000,
    totals: lineTotals(125_000, quantity, SIXTEEN_PERCENT),
  };
}

function hammerLine(): SaleLineToSave {
  const quantity = quantityOf(1000, 'piece');
  return {
    id: uuidV7(),
    productId: uuidV7(),
    productName: 'Martillo',
    quantity,
    unitPriceE4: 1_160_000,
    totals: lineTotals(1_160_000, quantity, SIXTEEN_PERCENT),
  };
}

function aSale(lines: readonly SaleLineToSave[] = [cableLine(), hammerLine()], saleId: string = uuidV7()): SaleToSave {
  const { subtotalCents, taxCents, totalCents } = saleTotals(lines.map((line) => line.totals));
  return { saleId, idempotencyKey: uuidV7(), lines, subtotalCents, taxCents, totalCents };
}

function row(sql: string, ...values: (string | number)[]): Record<string, unknown> | undefined {
  return store.prepare(sql).get(...values) as Record<string, unknown> | undefined;
}

function rows(sql: string, ...values: (string | number)[]): Record<string, unknown>[] {
  return store.prepare(sql).all(...values) as Record<string, unknown>[];
}

function statusOf(saleId: string): unknown {
  return row('SELECT status FROM sale WHERE id = ?', saleId)?.status;
}

function runSql(sql: string, ...values: (string | number)[]): void {
  store.transaction((connection) => {
    connection.prepare(sql).run(...values);
  });
}

function payInCash(sale: SaleToSave, target: SaleStore = sales): CompletedSale {
  return target.markCompleted(sale.saleId, [{ method: 'cash', amountCents: sale.totalCents, reference: null }]);
}

function pendingIds(): string[] {
  return sales.listPending().map(({ id }) => id);
}

describe('saving a sale as pending', () => {
  it('keeps the sale with the scales of ADR 0011 and the tenant', () => {
    const sale = aSale();

    sales.savePendingPayment(sale);

    expect(row('SELECT * FROM sale WHERE id = ?', sale.saleId)).toMatchObject({
      tenant_id: TENANT,
      idempotency_key: sale.idempotencyKey,
      status: 'pending_payment',
      subtotal_cents: 13529,
      tax_cents: 2165,
      total_cents: 15694,
      resolved_at: null,
    });
  });

  it('keeps each line as it was sold, in order', () => {
    const sale = aSale();

    sales.savePendingPayment(sale);

    expect(rows('SELECT * FROM sale_line WHERE sale_id = ? ORDER BY line_number', sale.saleId)).toMatchObject([
      {
        id: sale.lines[0]!.id,
        tenant_id: TENANT,
        line_number: 1,
        product_id: sale.lines[0]!.productId,
        product_name: 'Cable THW',
        unit: 'meter',
        quantity_milli: 3275,
        unit_price_e4: 125_000,
        tax_factor: 'rate',
        tax_rate_bp: 1600,
        subtotal_cents: 3529,
        tax_cents: 565,
        line_total_cents: 4094,
      },
      { line_number: 2, product_name: 'Martillo', unit: 'piece', quantity_milli: 1000, line_total_cents: 11600 },
    ]);
  });

  it('saves nothing at all when one line cannot be saved', () => {
    const broken: SaleLineToSave = { ...hammerLine(), productName: '   ' };
    const sale = aSale([cableLine(), broken]);

    expect(() => sales.savePendingPayment(sale)).toThrow(/CHECK/);

    expect(statusOf(sale.saleId)).toBeUndefined();
    expect(rows('SELECT id FROM sale_line')).toEqual([]);
  });

  it('can save a pending sale again, so another payment method can be tried, without repeating it', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);

    sales.savePendingPayment({ ...sale, idempotencyKey: uuidV7() });

    expect(rows('SELECT id FROM sale')).toHaveLength(1);
    expect(rows('SELECT id FROM sale_line')).toHaveLength(2);
    expect(row('SELECT idempotency_key FROM sale')?.idempotency_key).toBe(sale.idempotencyKey);
  });

  it('refuses to save again a sale that was already completed', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);
    payInCash(sale);

    expect(() => sales.savePendingPayment(sale)).toThrow(SaleAlreadyCompletedError);
  });

  it('refuses to bring back a sale that was cancelled', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);
    sales.cancel(sale.saleId);

    expect(() => sales.savePendingPayment(sale)).toThrow(InvalidSaleTransitionError);
    expect(statusOf(sale.saleId)).toBe('cancelled');
  });
});

describe('completing a sale', () => {
  it('records the payment for the whole total and moves it to completed', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);

    payInCash(sale);

    expect(statusOf(sale.saleId)).toBe('completed');
    expect(row('SELECT resolved_at FROM sale')?.resolved_at).toEqual(expect.any(String));
    expect(rows('SELECT tenant_id, sale_id, method, amount_cents, reference FROM payment')).toEqual([
      { tenant_id: TENANT, sale_id: sale.saleId, method: 'cash', amount_cents: 15694, reference: null },
    ]);
  });

  it('keeps only the authorization code of a card', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);

    sales.markCompleted(sale.saleId, [{ method: 'card', amountCents: sale.totalCents, reference: '482913' }]);

    expect(row('SELECT method, reference FROM payment')).toEqual({ method: 'card', reference: '482913' });
  });

  it('leaves the sale pending, with no payment, if any part of the change fails', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);
    store.transaction((connection) => {
      connection.exec(`
        CREATE TRIGGER fail_on_status BEFORE UPDATE OF status ON sale
        BEGIN SELECT RAISE(ABORT, 'disk full'); END;
      `);
    });

    expect(() => payInCash(sale)).toThrow('disk full');

    expect(statusOf(sale.saleId)).toBe('pending_payment');
    expect(rows('SELECT id FROM payment')).toEqual([]);
  });

  it('refuses to complete a sale twice, so the money is not counted twice', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);
    payInCash(sale);

    expect(() => payInCash(sale)).toThrow(InvalidSaleTransitionError);

    expect(rows('SELECT id FROM payment')).toHaveLength(1);
  });

  it('refuses to complete a cancelled sale', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);
    sales.cancel(sale.saleId);

    expect(() => payInCash(sale)).toThrow(InvalidSaleTransitionError);

    expect(statusOf(sale.saleId)).toBe('cancelled');
    expect(rows('SELECT id FROM payment')).toEqual([]);
  });

  it('says so when the sale does not exist', () => {
    expect(() => sales.markCompleted(uuidV7(), [{ method: 'cash', amountCents: 100, reference: null }])).toThrow(SaleNotFoundError);
  });
});

describe('completing a sale with several payments (RF-015)', () => {
  it('records each part of a mixed payment, and the sale completes once they add up', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);

    sales.markCompleted(sale.saleId, [
      { method: 'cash', amountCents: 10000, reference: null },
      { method: 'transfer', amountCents: 5694, reference: 'SPEI-778812' },
    ]);

    expect(statusOf(sale.saleId)).toBe('completed');
    expect(rows('SELECT method, amount_cents, reference FROM payment ORDER BY method')).toEqual([
      { method: 'cash', amount_cents: 10000, reference: null },
      { method: 'transfer', amount_cents: 5694, reference: 'SPEI-778812' },
    ]);
  });

  it('leaves the sale pending, with no payment at all, when the parts do not add up to the total', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);

    expect(() =>
      sales.markCompleted(sale.saleId, [
        { method: 'cash', amountCents: 10000, reference: null },
        { method: 'transfer', amountCents: 5000, reference: 'SPEI-778812' },
      ]),
    ).toThrow('must add up to its total');

    expect(statusOf(sale.saleId)).toBe('pending_payment');
    expect(rows('SELECT id FROM payment')).toEqual([]);
  });

  it('leaves the sale pending when one part passes the total', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);

    expect(() =>
      sales.markCompleted(sale.saleId, [
        { method: 'cash', amountCents: 15694, reference: null },
        { method: 'transfer', amountCents: 1, reference: 'SPEI-778812' },
      ]),
    ).toThrow('must add up to its total');

    expect(rows('SELECT id FROM payment')).toEqual([]);
  });

  it('refuses a sale completed with no payment at all', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);

    expect(() => sales.markCompleted(sale.saleId, [])).toThrow('must add up to its total');
  });

  it('refuses a transfer without its reference, in the database too', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);

    expect(() =>
      sales.markCompleted(sale.saleId, [{ method: 'transfer', amountCents: 15694, reference: null }]),
    ).toThrow('reference');
    expect(() =>
      sales.markCompleted(sale.saleId, [{ method: 'transfer', amountCents: 15694, reference: '   ' }]),
    ).toThrow('reference');

    expect(statusOf(sale.saleId)).toBe('pending_payment');
  });

  it('records a card typed on the standalone terminal with its folio (RF-016)', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);

    sales.markCompleted(sale.saleId, [{ method: 'card_manual', amountCents: sale.totalCents, reference: 'A48291' }]);

    expect(row('SELECT method, amount_cents, reference FROM payment')).toEqual({
      method: 'card_manual',
      amount_cents: sale.totalCents,
      reference: 'A48291',
    });
  });

  it('refuses a card payment without its folio, in the database too', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);

    expect(() => sales.markCompleted(sale.saleId, [{ method: 'card_manual', amountCents: sale.totalCents, reference: null }])).toThrow(
      'needs its reference',
    );
    expect(() => sales.markCompleted(sale.saleId, [{ method: 'card_manual', amountCents: sale.totalCents, reference: '  ' }])).toThrow(
      'needs its reference',
    );

    expect(statusOf(sale.saleId)).toBe('pending_payment');
  });

  it('refuses a payment method the register does not know', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);

    expect(() =>
      runSql(
        `INSERT INTO payment (id, tenant_id, sale_id, method, amount_cents, recorded_at)
         VALUES (?, ?, ?, 'barter', 100, '2026-11-08T00:00:00.000Z')`,
        uuidV7(),
        TENANT,
        sale.saleId,
      ),
    ).toThrow('payment method');
  });
});

describe('the short folio of a sale (RF-018)', () => {
  it('gives each completed sale the next number, starting at 1', () => {
    const first = aSale();
    const second = aSale();
    sales.savePendingPayment(first);
    sales.savePendingPayment(second);

    const firstDone = payInCash(first);
    const secondDone = payInCash(second);

    expect([firstDone.folio, secondDone.folio]).toEqual([1, 2]);
    expect(firstDone.completedAt).toEqual(expect.any(String));
    expect(rows('SELECT folio FROM sale ORDER BY folio')).toEqual([{ folio: 1 }, { folio: 2 }]);
  });

  it('leaves no gap when a sale is cancelled, because only completed sales get a folio', () => {
    const cancelled = aSale();
    const kept = aSale();
    sales.savePendingPayment(cancelled);
    sales.savePendingPayment(kept);
    sales.cancel(cancelled.saleId);

    expect(payInCash(kept).folio).toBe(1);
    expect(row('SELECT folio FROM sale WHERE id = ?', cancelled.saleId)?.folio).toBeNull();
  });

  it('numbers each business on its own', () => {
    const other = new SaleStore(store, OTHER_TENANT);
    const mine = aSale();
    const theirs = aSale();
    sales.savePendingPayment(mine);
    other.savePendingPayment(theirs);

    expect(payInCash(mine).folio).toBe(1);
    expect(payInCash(theirs, other).folio).toBe(1);
  });

  it('keeps counting after the register restarts', () => {
    const first = aSale();
    sales.savePendingPayment(first);
    payInCash(first);
    store.close();
    openStore();
    const second = aSale();
    sales.savePendingPayment(second);

    expect(payInCash(second).folio).toBe(2);
  });

  it('is refused by the database when a sale is completed without one', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);
    runSql(
      `INSERT INTO payment (id, tenant_id, sale_id, method, amount_cents, recorded_at)
       VALUES (?, ?, ?, 'cash', ?, '2026-11-08T00:00:00.000Z')`,
      uuidV7(),
      TENANT,
      sale.saleId,
      sale.totalCents,
    );

    expect(() => runSql("UPDATE sale SET status = 'completed' WHERE id = ?", sale.saleId)).toThrow('needs its folio');
  });

  it('is refused by the database when it changes, or repeats', () => {
    const first = aSale();
    const second = aSale();
    sales.savePendingPayment(first);
    sales.savePendingPayment(second);
    payInCash(first);

    expect(() => runSql('UPDATE sale SET folio = 9 WHERE id = ?', first.saleId)).toThrow();
    expect(() => runSql('UPDATE sale SET folio = 1 WHERE id = ?', second.saleId)).toThrow(/UNIQUE/);
  });
});

describe('reading the last completed sale (reprint)', () => {
  it('finds nothing when no sale was completed, and ignores pending and cancelled ones', () => {
    const pending = aSale();
    const cancelled = aSale();
    sales.savePendingPayment(pending);
    sales.savePendingPayment(cancelled);
    sales.cancel(cancelled.saleId);

    expect(sales.findLastCompletedSale()).toBeNull();
  });

  it('gives the sale with its folio, its time, and its payments in the order they were recorded', () => {
    const older = aSale();
    const newer = aSale();
    sales.savePendingPayment(older);
    sales.savePendingPayment(newer);
    payInCash(older);
    const done = sales.markCompleted(newer.saleId, [
      { method: 'transfer', amountCents: 5694, reference: 'SPEI-778812' },
      { method: 'cash', amountCents: 10000, reference: null },
    ]);

    expect(sales.findLastCompletedSale()).toEqual({
      folio: 2,
      completedAt: done.completedAt,
      sale: newer,
      payments: [
        { method: 'transfer', amountCents: 5694, reference: 'SPEI-778812' },
        { method: 'cash', amountCents: 10000, reference: null },
      ],
    });
  });

  it('does not read the sales of another business', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);
    payInCash(sale);

    expect(new SaleStore(store, OTHER_TENANT).findLastCompletedSale()).toBeNull();
  });
});

describe('reading a pending sale back', () => {
  it('rebuilds what was saved, so a ticket can be printed from it', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);

    expect(sales.findPendingSale(sale.saleId)).toEqual(sale);
  });

  it('finds nothing for a sale that is resolved, missing, or from another business', () => {
    const completed = aSale();
    const pending = aSale();
    sales.savePendingPayment(completed);
    sales.savePendingPayment(pending);
    sales.markCompleted(completed.saleId, [{ method: 'cash', amountCents: completed.totalCents, reference: null }]);

    expect(sales.findPendingSale(completed.saleId)).toBeNull();
    expect(sales.findPendingSale(uuidV7())).toBeNull();
    expect(new SaleStore(store, OTHER_TENANT).findPendingSale(pending.saleId)).toBeNull();
  });
});

describe('cancelling a sale', () => {
  it('moves it to cancelled and keeps it, with no payment', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);

    sales.cancel(sale.saleId);

    expect(statusOf(sale.saleId)).toBe('cancelled');
    expect(row('SELECT resolved_at FROM sale')?.resolved_at).toEqual(expect.any(String));
    expect(rows('SELECT id FROM sale_line')).toHaveLength(2);
    expect(rows('SELECT id FROM payment')).toEqual([]);
  });

  it('refuses to cancel a completed sale', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);
    payInCash(sale);

    expect(() => sales.cancel(sale.saleId)).toThrow(InvalidSaleTransitionError);

    expect(statusOf(sale.saleId)).toBe('completed');
  });

  it('says so when the sale does not exist', () => {
    expect(() => sales.cancel(uuidV7())).toThrow(SaleNotFoundError);
  });
});

describe('finding pending sales', () => {
  it('lists them oldest first, with what the cashier needs to recognize each one', () => {
    const newer = aSale([hammerLine()], uuidV7(2_000));
    const older = aSale([cableLine(), hammerLine()], uuidV7(1_000));
    sales.savePendingPayment(newer);
    sales.savePendingPayment(older);

    const pending = sales.listPending();

    expect(pending.map(({ id }) => id)).toEqual([older.saleId, newer.saleId]);
    expect(pending[0]).toEqual({
      id: older.saleId,
      occurredAt: expect.any(String),
      totalCents: 15694,
      lines: [
        { productName: 'Cable THW', quantity: { milli: 3275, unit: 'meter' }, unitPriceE4: 125_000, totalCents: 4094 },
        { productName: 'Martillo', quantity: { milli: 1000, unit: 'piece' }, unitPriceE4: 1_160_000, totalCents: 11600 },
      ],
    });
  });

  it('leaves out the sales already resolved', () => {
    const completed = aSale();
    const cancelled = aSale();
    const pending = aSale();
    [completed, cancelled, pending].forEach((sale) => sales.savePendingPayment(sale));

    payInCash(completed);
    sales.cancel(cancelled.saleId);

    expect(pendingIds()).toEqual([pending.saleId]);
  });

  it('finds a pending sale by its idempotency key', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);

    expect(sales.findPendingByIdempotencyKey(sale.idempotencyKey)?.id).toBe(sale.saleId);
    expect(sales.findPendingByIdempotencyKey(uuidV7())).toBeNull();
  });

  it('still finds the pending sale after the register restarts', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);

    store.close();
    openStore();

    expect(pendingIds()).toEqual([sale.saleId]);
  });
});

describe('another business', () => {
  let otherSales: SaleStore;

  beforeEach(() => {
    otherSales = new SaleStore(store, OTHER_TENANT);
  });

  it('does not see the pending sales of this one', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);

    expect(otherSales.listPending()).toEqual([]);
    expect(otherSales.findPendingByIdempotencyKey(sale.idempotencyKey)).toBeNull();
  });

  it('cannot resolve the sales of this one', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);

    expect(() => otherSales.cancel(sale.saleId)).toThrow(SaleNotFoundError);
    expect(() => payInCash(sale, otherSales)).toThrow(SaleNotFoundError);

    expect(statusOf(sale.saleId)).toBe('pending_payment');
  });

  it('can use the same idempotency key', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);

    otherSales.savePendingPayment({ ...aSale(), idempotencyKey: sale.idempotencyKey });

    expect(rows('SELECT id FROM sale')).toHaveLength(2);
  });
});

describe('what counts in stock and in the cash-up (ADR 0010)', () => {
  function counted(): unknown[] {
    return rows('SELECT id FROM counted_sale').map(({ id }) => id);
  }

  it('does not count a pending sale', () => {
    sales.savePendingPayment(aSale());

    expect(counted()).toEqual([]);
  });

  it('does not count a cancelled sale', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);
    sales.cancel(sale.saleId);

    expect(counted()).toEqual([]);
  });

  it('counts a sale once it is completed', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);
    payInCash(sale);

    expect(counted()).toEqual([sale.saleId]);
  });

  it('has no payment to add to the cash-up until the sale is completed', () => {
    const sale = aSale();
    sales.savePendingPayment(sale);

    expect(rows('SELECT id FROM payment')).toEqual([]);
  });
});

describe('the database itself refuses what the rules forbid', () => {
  function savedSale(): SaleToSave {
    const sale = aSale();
    sales.savePendingPayment(sale);
    return sale;
  }

  function completedSale(): SaleToSave {
    const sale = savedSale();
    payInCash(sale);
    return sale;
  }

  function insertSale(status: string): void {
    runSql(
      `INSERT INTO sale (id, tenant_id, idempotency_key, status, subtotal_cents, tax_cents, total_cents, occurred_at)
       VALUES (?, ?, ?, ?, 100, 16, 116, '2026-11-08T00:00:00.000Z')`,
      uuidV7(),
      TENANT,
      uuidV7(),
      status,
    );
  }

  function insertLine(saleId: string): void {
    runSql(
      `INSERT INTO sale_line (id, tenant_id, sale_id, line_number, product_id, product_name, unit, quantity_milli,
         unit_price_e4, tax_factor, tax_rate_bp, subtotal_cents, tax_cents, line_total_cents)
       VALUES (?, ?, ?, 99, ?, 'Clavo', 'piece', 1000, 11600, 'rate', 1600, 100, 16, 116)`,
      uuidV7(),
      TENANT,
      saleId,
      uuidV7(),
    );
  }

  function insertPayment(saleId: string, amountCents: number): void {
    runSql(
      `INSERT INTO payment (id, tenant_id, sale_id, method, amount_cents, recorded_at)
       VALUES (?, ?, ?, 'cash', ?, '2026-11-08T00:00:00.000Z')`,
      uuidV7(),
      TENANT,
      saleId,
      amountCents,
    );
  }

  it('makes every sale start as pending', () => {
    expect(() => insertSale('completed')).toThrow('must start as pending_payment');
  });

  it('refuses an unknown state', () => {
    const sale = savedSale();

    expect(() => runSql("UPDATE sale SET status = 'lost' WHERE id = ?", sale.saleId)).toThrow('invalid sale transition');
  });

  it('refuses to complete a sale whose payments do not add up to its total', () => {
    const sale = savedSale();
    insertPayment(sale.saleId, 100);

    expect(() => runSql("UPDATE sale SET status = 'completed', folio = 1 WHERE id = ?", sale.saleId)).toThrow('must add up to its total');
  });

  it('refuses to change a completed sale', () => {
    const sale = completedSale();

    expect(() => runSql("UPDATE sale SET status = 'cancelled' WHERE id = ?", sale.saleId)).toThrow();
    expect(() => runSql("UPDATE sale SET resolved_at = 'yesterday' WHERE id = ?", sale.saleId)).toThrow('resolved');
  });

  it('refuses to change a cancelled sale', () => {
    const sale = savedSale();
    sales.cancel(sale.saleId);

    expect(() => runSql("UPDATE sale SET status = 'completed' WHERE id = ?", sale.saleId)).toThrow();
  });

  it('refuses to change the amounts or the identity of a pending sale', () => {
    const sale = savedSale();

    expect(() => runSql('UPDATE sale SET total_cents = 1, subtotal_cents = 1, tax_cents = 0 WHERE id = ?', sale.saleId)).toThrow(
      'never change',
    );
    expect(() => runSql("UPDATE sale SET tenant_id = 'x' WHERE id = ?", sale.saleId)).toThrow('never change');
  });

  it('never deletes a sale, whatever its state', () => {
    const pending = savedSale();
    const completed = completedSale();

    expect(() => runSql('DELETE FROM sale WHERE id = ?', pending.saleId)).toThrow('never deleted');
    expect(() => runSql('DELETE FROM sale WHERE id = ?', completed.saleId)).toThrow('never deleted');
  });

  it('refuses a line for a sale that is no longer pending', () => {
    const sale = completedSale();

    expect(() => insertLine(sale.saleId)).toThrow('pending');
  });

  it('never changes or deletes a line', () => {
    const sale = savedSale();

    expect(() => runSql('UPDATE sale_line SET quantity_milli = 1 WHERE sale_id = ?', sale.saleId)).toThrow('never changes');
    expect(() => runSql('DELETE FROM sale_line WHERE sale_id = ?', sale.saleId)).toThrow('never deleted');
  });

  it('refuses a payment for a sale that is no longer pending', () => {
    const sale = completedSale();

    expect(() => insertPayment(sale.saleId, 1)).toThrow('pending');
  });

  it('never changes or deletes a payment', () => {
    const sale = completedSale();

    expect(() => runSql('UPDATE payment SET amount_cents = 1 WHERE sale_id = ?', sale.saleId)).toThrow('never changes');
    expect(() => runSql('DELETE FROM payment WHERE sale_id = ?', sale.saleId)).toThrow('never deleted');
  });
});

function cashPayment(sale: SaleToSave): CheckoutPayment {
  return { kind: 'in_person', payments: [{ method: 'cash', amountCents: sale.totalCents, reference: null }], changeCents: 0 };
}

describe('checkout on the real database', () => {
  function setUp(): { checkout: SaleCheckout; hardware: ReturnType<typeof createFakeHardware> } {
    const hardware = createFakeHardware();
    const checkout = new SaleCheckout({ hardware, sales, renderTicket: () => new Uint8Array() });
    return { checkout, hardware };
  }

  it('leaves a cash sale completed, with its payment', async () => {
    const { checkout } = setUp();
    const base = aSale();
    const sale = { ...base, payment: cashPayment(base) };

    await checkout.checkout(sale);

    expect(statusOf(sale.saleId)).toBe('completed');
    expect(row('SELECT amount_cents FROM payment')).toEqual({ amount_cents: 15694 });
  });

  it('leaves a sale with a declined card pending, to be saved again and paid another way', async () => {
    const { checkout, hardware } = setUp();
    hardware.cardTerminal.willRespond({ status: 'declined', reason: 'Fondos insuficientes' });
    const sale = { ...aSale(), payment: { kind: 'card' } } as const;

    await checkout.checkout(sale);
    await checkout.checkout({ ...sale, idempotencyKey: uuidV7(), payment: cashPayment(sale) });

    expect(statusOf(sale.saleId)).toBe('completed');
    expect(rows('SELECT id FROM sale')).toHaveLength(1);
  });
});
