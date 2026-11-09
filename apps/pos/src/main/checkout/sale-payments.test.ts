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
import { renderTicket } from './ticket/ticket';
import { toTicketData } from './ticket/ticket-data';

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
  const businessName = (): string => 'Tlapalería Torres';
  salePayments = new SalePayments(
    sales,
    new SaleCheckout({
      hardware,
      sales,
      renderTicket: (sale, receipt) => renderTicket(toTicketData(businessName(), sale, { ...receipt, isReprint: false })),
    }),
    { printer: hardware.printer, businessName },
  );
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

    expect(result).toEqual({ status: 'completed', folio: 'T1-000001', changeCents: 5000, problems: [] });
    expect(rowsIn('sale')).toMatchObject([{ id: saleId, status: 'completed' }]);
    expect(rowsIn('payment')).toMatchObject([{ sale_id: saleId, method: 'cash', amount_cents: 10000, reference: null }]);
    expect(hardware.cashDrawer.openCount).toBe(1);
    expect(hardware.printer.jobs).toHaveLength(1);
  });

  it('prints a ticket with the folio, the VAT, the payments, and the change', async () => {
    const saleId = saveSaleOf100();

    await salePayments.checkout(request(saleId, 15000));

    const ticket = new TextDecoder('latin1').decode(hardware.printer.printedBytes());
    expect(ticket).toContain('Tlapaler');
    expect(ticket).toContain('Folio T1-000001');
    expect(ticket).toMatch(/Martillo\s+\$100\.00/);
    expect(ticket).toMatch(/IVA 16%\s+\$13\.79/);
    expect(ticket).toMatch(/Cambio\s+\$50\.00/);
    expect(ticket).not.toContain('REIMPRES');
  });

  it('gives the next folio to each sale', async () => {
    const first = await salePayments.checkout(request(saveSaleOf100(), 10000));
    const second = await salePayments.checkout(request(saveSaleOf100(), 10000));

    expect([first, second]).toMatchObject([{ folio: 'T1-000001' }, { folio: 'T1-000002' }]);
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

  it('records a card typed on the terminal with its folio, next to the cash, and prints it on the ticket (RF-016)', async () => {
    const saleId = saveSaleOf100();

    const result = await salePayments.checkout({ saleId, cashReceivedCents: 6000, transfers: [], cards: [{ amountCents: 4000, reference: 'A48291' }] });

    expect(result).toMatchObject({ status: 'completed', changeCents: 0 });
    expect(rowsIn('payment')).toMatchObject([
      { method: 'cash', amount_cents: 6000, reference: null },
      { method: 'card_manual', amount_cents: 4000, reference: 'A48291' },
    ]);
    expect(new TextDecoder('latin1').decode(hardware.printer.printedBytes())).toMatch(/Tarjeta folio A48291\s+\$40\.00/);
  });

  it('never keeps a card number: a folio that looks like one is refused and nothing is recorded', async () => {
    const saleId = saveSaleOf100();

    const result = await salePayments.checkout({ saleId, cashReceivedCents: 0, transfers: [], cards: [{ amountCents: 10000, reference: '4111 1111 1111 1111' }] });

    expect(result).toEqual({ status: 'payment_refused', plan: { status: 'card_number_entered' } });
    expect(rowsIn('payment')).toEqual([]);
    expect(JSON.stringify(rowsIn('payment'))).not.toContain('4111');
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

describe('reprintLast', () => {
  it('says so when no sale was completed yet', async () => {
    saveSaleOf100();

    expect(await salePayments.reprintLast()).toEqual({ status: 'no_sales' });
    expect(hardware.printer.jobs).toEqual([]);
  });

  it('prints the last completed sale again, marked as a reprint and without inventing the change', async () => {
    await salePayments.checkout(request(saveSaleOf100(), 15000));
    await salePayments.checkout(request(saveSaleOf100(), 10000, []));
    const originalJobs = hardware.printer.jobs.length;

    const result = await salePayments.reprintLast();

    expect(result).toEqual({ status: 'printed', folio: 'T1-000002' });
    const copy = new TextDecoder('latin1').decode(hardware.printer.jobs[originalJobs]);
    expect(copy).toContain('Folio T1-000002');
    expect(copy).toContain('REIMPRES');
    expect(copy).not.toContain('Cambio');
    expect(hardware.cashDrawer.openCount).toBe(2);
  });

  it('keeps the sale, and says why, when the printer has no paper', async () => {
    await salePayments.checkout(request(saveSaleOf100(), 10000));
    hardware.printer.failNextWith();

    const result = await salePayments.reprintLast();

    expect(result).toEqual({ status: 'printer_failed', folio: 'T1-000001', message: 'The printer is out of paper' });
    expect(rowsIn('sale')).toMatchObject([{ status: 'completed' }]);
  });
});