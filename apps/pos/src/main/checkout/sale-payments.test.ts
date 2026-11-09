import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PaymentRequest } from '../../shared/pos-api';
import { createFakeHardware, type FakeHardware } from '../hardware/fakes/fake-hardware';
import { LocalStore } from '../local-store/local-store';
import { ProductCatalog } from '../local-store/product-catalog';
import { SaleNotFoundError, SaleStore } from '../local-store/sale-store';
import { uuidV7 } from '../uuid-v7';
import { PendingSales } from './pending-sales';
import { SaleCheckout } from './sale-checkout';
import { SalePayments } from './sale-payments';

const TENANT = 'tenant-a';
const REFERENCE = 'SPEI-778812';

let directory: string;
let store: LocalStore;
let hardware: FakeHardware;
let pendingSales: PendingSales;
let salePayments: SalePayments;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'sale-payments-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  const sales = new SaleStore(store, TENANT);
  hardware = createFakeHardware();
  pendingSales = new PendingSales(new ProductCatalog(store, TENANT), sales);
  salePayments = new SalePayments(sales, new SaleCheckout({ hardware, sales, renderTicket: () => new Uint8Array([1]) }));
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

/** Saves a sale of one product that costs $100.00 with VAT, as the payment screen does before asking for money. */
function saveSaleOf100(): string {
  const productId = uuidV7();
  store.transaction((connection) => {
    connection
      .prepare(
        `INSERT INTO product (id, tenant_id, name, base_unit, unit_price_e4, tax_factor, tax_rate_bp)
         VALUES (?, ?, 'Martillo', 'piece', 1000000, 'rate', 1600)`,
      )
      .run(productId, TENANT);
  });
  const result = pendingSales.save({
    idempotencyKey: crypto.randomUUID(),
    lines: [{ productId, quantityMilli: 1000 }],
    expectedTotalCents: 10000,
  });
  if (result.status !== 'saved') {
    throw new Error('The sale should have been saved');
  }
  return result.sale.id;
}

function request(saleId: string, cashReceivedCents: number, transfers: PaymentRequest['transfers'] = []): PaymentRequest {
  return { saleId, cashReceivedCents, transfers };
}

function rowsIn(table: string): Record<string, unknown>[] {
  return store.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
}

describe('checkout', () => {
  it('completes a cash sale, gives the change, opens the drawer, and prints', async () => {
    const saleId = saveSaleOf100();

    const result = await salePayments.checkout(request(saleId, 15000));

    expect(result).toEqual({ status: 'completed', changeCents: 5000, problems: [] });
    expect(rowsIn('sale')).toMatchObject([{ id: saleId, status: 'completed' }]);
    expect(rowsIn('payment')).toMatchObject([{ sale_id: saleId, method: 'cash', amount_cents: 10000, reference: null }]);
    expect(hardware.cashDrawer.openCount).toBe(1);
    expect(hardware.printer.jobs).toHaveLength(1);
  });

  it('records $60 in cash and $40 by transfer as two payments of one sale (RF-015)', async () => {
    const saleId = saveSaleOf100();

    const result = await salePayments.checkout(request(saleId, 6000, [{ amountCents: 4000, reference: REFERENCE }]));

    expect(result).toMatchObject({ status: 'completed', changeCents: 0 });
    expect(rowsIn('payment')).toMatchObject([
      { method: 'cash', amount_cents: 6000, reference: null },
      { method: 'transfer', amount_cents: 4000, reference: REFERENCE },
    ]);
  });

  it('keeps the drawer closed for a sale paid only by transfer', async () => {
    const saleId = saveSaleOf100();

    await salePayments.checkout(request(saleId, 0, [{ amountCents: 10000, reference: REFERENCE }]));

    expect(hardware.cashDrawer.openCount).toBe(0);
    expect(hardware.printer.jobs).toHaveLength(1);
  });

  it('refuses payments that do not reach the total, and records nothing', async () => {
    const saleId = saveSaleOf100();

    const result = await salePayments.checkout(request(saleId, 9999));

    expect(result).toEqual({ status: 'payment_refused', plan: { status: 'short', missingCents: 1 } });
    expect(rowsIn('payment')).toEqual([]);
    expect(rowsIn('sale')).toMatchObject([{ status: 'pending_payment' }]);
    expect(hardware.cashDrawer.openCount).toBe(0);
    expect(hardware.printer.jobs).toEqual([]);
  });

  it('refuses a transfer without its reference', async () => {
    const saleId = saveSaleOf100();

    const result = await salePayments.checkout(request(saleId, 0, [{ amountCents: 10000, reference: '  ' }]));

    expect(result).toEqual({ status: 'payment_refused', plan: { status: 'reference_missing' } });
    expect(rowsIn('payment')).toEqual([]);
  });

  it('says so when the sale does not exist, and when it was already completed', async () => {
    const saleId = saveSaleOf100();
    await salePayments.checkout(request(saleId, 10000));

    await expect(salePayments.checkout(request(uuidV7(), 10000))).rejects.toThrow(SaleNotFoundError);
    await expect(salePayments.checkout(request(saleId, 10000))).rejects.toThrow(SaleNotFoundError);

    expect(rowsIn('payment')).toHaveLength(1);
  });

  it('still completes the sale when the printer has no paper, and reports it', async () => {
    const saleId = saveSaleOf100();
    hardware.printer.failNextWith();

    const result = await salePayments.checkout(request(saleId, 10000));

    expect(result).toMatchObject({ status: 'completed', problems: [{ device: 'printer' }] });
    expect(rowsIn('sale')).toMatchObject([{ status: 'completed' }]);
  });
});

describe('confirm', () => {
  it('records how a recovered sale was paid, without opening the drawer or printing', () => {
    const saleId = saveSaleOf100();

    const result = salePayments.confirm(request(saleId, 6000, [{ amountCents: 4000, reference: REFERENCE }]));

    expect(result).toMatchObject({ status: 'completed' });
    expect(rowsIn('payment')).toMatchObject([
      { method: 'cash', amount_cents: 6000 },
      { method: 'transfer', amount_cents: 4000, reference: REFERENCE },
    ]);
    expect(hardware.cashDrawer.openCount).toBe(0);
    expect(hardware.printer.jobs).toEqual([]);
  });

  it('refuses a payment that does not add up, and leaves the sale pending', () => {
    const saleId = saveSaleOf100();

    expect(salePayments.confirm(request(saleId, 5000))).toEqual({
      status: 'payment_refused',
      plan: { status: 'short', missingCents: 5000 },
    });

    expect(rowsIn('sale')).toMatchObject([{ status: 'pending_payment' }]);
    expect(rowsIn('payment')).toEqual([]);
  });

  it('says so when the sale does not exist', () => {
    expect(() => salePayments.confirm(request(uuidV7(), 10000))).toThrow(SaleNotFoundError);
  });
});
