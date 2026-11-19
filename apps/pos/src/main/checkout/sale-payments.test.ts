import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { PaymentRequest } from '../../shared/pos-api';
import { DEFAULT_TICKET_DESIGN, type TicketDesign } from '../../shared/register-tools';
import { AuditLog } from '../audit/audit-log';
import { createFakeHardware, type FakeHardware } from '../hardware/fakes/fake-hardware';
import { CashSessionStore } from '../cash/cash-session-store';
import { LocalStore } from '../local-store/local-store';
import { ProductCatalog } from '../local-store/product-catalog';
import { SaleNotFoundError, SaleStore } from '../local-store/sale-store';
import { uuidV7 } from '../uuid-v7';
import { PendingSales } from './pending-sales';
import { SaleCheckout } from './sale-checkout';
import { SalePayments } from './sale-payments';
import { TicketPrintLog } from './ticket-print-log';
import { renderTicket } from './ticket/ticket';
import { toTicketData } from './ticket/ticket-data';

const TENANT = 'tenant-a';
const REFERENCE = 'SPEI-778812';

let directory: string;
let store: LocalStore;
let hardware: FakeHardware;
let pendingSales: PendingSales;
let salePayments: SalePayments;
let printLog: TicketPrintLog;
/** Most of these tests check what happens once a ticket prints, so they print every time, as before E1-59. */
let design: TicketDesign;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'sale-payments-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  const sales = new SaleStore(store, TENANT);
  hardware = createFakeHardware();
  const cashSessionId = new CashSessionStore(store, TENANT).open(uuidV7(), 0);
  pendingSales = new PendingSales(new ProductCatalog(store, TENANT), sales, () => ({ cashierId: uuidV7(), cashSessionId }));
  const businessName = (): string => 'Tlapalería Torres';
  design = { ...DEFAULT_TICKET_DESIGN, printPolicy: 'always' };
  printLog = new TicketPrintLog(store, TENANT, { audit: new AuditLog(store, TENANT), currentUserId: () => 'cashier-1' });
  salePayments = new SalePayments(
    sales,
    new SaleCheckout({
      hardware,
      sales,
      renderTicket: (sale, receipt) => renderTicket(toTicketData(businessName(), sale, { ...receipt, isReprint: false })),
    }),
    { printer: hardware.printer, businessName, ticketDesign: () => design, printLog },
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

    expect(result).toEqual({ status: 'completed', folio: 'T1-000001', changeCents: 5000, problems: [], ticket: 'printed' });
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

    const result = await salePayments.checkout({ saleId, cashReceivedCents: 0, transfers: [], cards: [{ amountCents: 10000, reference: ['4111', '1111', '1111', '1111'].join(' ') }] });

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

    expect(result).toMatchObject({ status: 'completed', problems: [{ device: 'printer' }], ticket: 'not_printed' });
    expect(rowsIn('sale')).toMatchObject([{ status: 'completed' }]);
    expect(printLog.wasPrinted(saleId)).toBe(false);
  });
});

describe('confirm', () => {
  it('records how a recovered sale was paid, without opening the drawer or printing', () => {
    const saleId = saveSaleOf100();

    const result = salePayments.confirm(request(saleId, 6000, [{ amountCents: 4000, reference: REFERENCE }]));

    expect(result).toMatchObject({ status: 'completed', ticket: 'not_printed' });
    expect(printLog.wasPrinted(saleId)).toBe(false);
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
/** The audit entries about the ticket of a sale, oldest first. */
function ticketEntries(saleId: string): string[] {
  const rows = store
    .prepare(`SELECT action FROM audit_log WHERE entity = 'sale' AND entity_id = ? AND action LIKE 'sale.ticket%' ORDER BY rowid`)
    .all(saleId) as { action: string }[];
  return rows.map((row) => row.action);
}

describe('ask whether to print the ticket (E1-59)', () => {
  beforeEach(() => {
    design = { ...DEFAULT_TICKET_DESIGN, printPolicy: 'ask' };
  });

  it('records the sale and opens the drawer, but prints nothing until the cashier answers', async () => {
    const saleId = saveSaleOf100();

    const result = await salePayments.checkout(request(saleId, 15000));

    expect(result).toEqual({ status: 'completed', folio: 'T1-000001', changeCents: 5000, problems: [], ticket: 'ask' });
    expect(rowsIn('sale')).toMatchObject([{ id: saleId, status: 'completed' }]);
    expect(hardware.cashDrawer.openCount).toBe(1);
    expect(hardware.printer.jobs).toEqual([]);
    expect(printLog.wasPrinted(saleId)).toBe(false);
  });

  it('prints the first ticket with its change, every copy, when the cashier says yes', async () => {
    design = { ...design, copies: 2 };
    const saleId = saveSaleOf100();
    await salePayments.checkout(request(saleId, 15000));

    const result = await salePayments.printTicket(saleId);

    expect(result).toEqual({ status: 'printed', folio: 'T1-000001' });
    expect(hardware.printer.jobs).toHaveLength(1);
    const ticket = new TextDecoder('latin1').decode(hardware.printer.printedBytes());
    expect(ticket).toMatch(/Cambio\s+\$50\.00/);
    expect(ticket).not.toContain('REIMPRES');
    expect(ticket.split('Folio T1-000001')).toHaveLength(3);
    expect(printLog.wasPrinted(saleId)).toBe(true);
    expect(ticketEntries(saleId)).toEqual(['sale.ticket_not_printed', 'sale.ticket_printed']);
  });

  it('leaves the sale without its ticket when the cashier says no, and never changes the sale', async () => {
    const saleId = saveSaleOf100();
    await salePayments.checkout(request(saleId, 10000));
    const saleBefore = rowsIn('sale');

    // Saying no sends nothing to the register: the sale was already recorded as without its ticket.
    expect(hardware.printer.jobs).toEqual([]);
    expect(rowsIn('sale')).toEqual(saleBefore);
    expect(printLog.wasPrinted(saleId)).toBe(false);
  });

  it('prints a sale that was not printed from «Reimprimir» as its first ticket, without the change', async () => {
    const saleId = saveSaleOf100();
    await salePayments.checkout(request(saleId, 15000));
    // The next sale replaces the question: only the last one keeps its change for the answer.
    const lastId = saveSaleOf100();
    await salePayments.checkout(request(lastId, 10000));

    const result = await salePayments.reprintLast();

    expect(result).toEqual({ status: 'printed', folio: 'T1-000002' });
    const ticket = new TextDecoder('latin1').decode(hardware.printer.printedBytes());
    expect(ticket).toContain('Folio T1-000002');
    expect(ticket).not.toContain('REIMPRES');
    expect(printLog.wasPrinted(lastId)).toBe(true);
    expect(printLog.wasPrinted(saleId)).toBe(false);
  });

  it('prints an older sale from the history without the change, and marks the next one as a reprint', async () => {
    const firstId = saveSaleOf100();
    await salePayments.checkout(request(firstId, 15000));
    await salePayments.checkout(request(saveSaleOf100(), 10000));

    expect(await salePayments.printTicket(firstId)).toEqual({ status: 'printed', folio: 'T1-000001' });
    const first = new TextDecoder('latin1').decode(hardware.printer.jobs[0]);
    expect(first).not.toContain('Cambio');
    expect(first).not.toContain('REIMPRES');

    expect(await salePayments.printTicket(firstId)).toEqual({ status: 'printed', folio: 'T1-000001' });
    expect(new TextDecoder('latin1').decode(hardware.printer.jobs[1])).toContain('REIMPRES');
  });

  it('keeps the sale without its ticket, and says why, when the printer fails on the answer', async () => {
    const saleId = saveSaleOf100();
    await salePayments.checkout(request(saleId, 15000));
    hardware.printer.failNextWith();

    const result = await salePayments.printTicket(saleId);

    expect(result).toEqual({ status: 'printer_failed', folio: 'T1-000001', message: 'The printer is out of paper' });
    expect(printLog.wasPrinted(saleId)).toBe(false);
    // The answer can be given again, still with the change.
    expect(await salePayments.printTicket(saleId)).toEqual({ status: 'printed', folio: 'T1-000001' });
    expect(new TextDecoder('latin1').decode(hardware.printer.printedBytes())).toContain('Cambio');
  });

  it('says so when the sale does not exist or is not completed', async () => {
    const pendingId = saveSaleOf100();

    expect(await salePayments.printTicket(uuidV7())).toEqual({ status: 'not_found' });
    expect(await salePayments.printTicket(pendingId)).toEqual({ status: 'not_found' });
    expect(hardware.printer.jobs).toEqual([]);
  });

  it('never prints when the owner chose so, and still lets the ticket be printed later', async () => {
    design = { ...design, printPolicy: 'never' };
    const saleId = saveSaleOf100();

    const result = await salePayments.checkout(request(saleId, 10000));

    expect(result).toMatchObject({ status: 'completed', ticket: 'not_printed' });
    expect(hardware.printer.jobs).toEqual([]);
    expect(await salePayments.printTicket(saleId)).toEqual({ status: 'printed', folio: 'T1-000001' });
    expect(printLog.wasPrinted(saleId)).toBe(true);
  });

  it('prints right away and records it when the owner chose to always print', async () => {
    design = { ...design, printPolicy: 'always' };
    const saleId = saveSaleOf100();

    expect(await salePayments.checkout(request(saleId, 10000))).toMatchObject({ ticket: 'printed' });
    expect(hardware.printer.jobs).toHaveLength(1);
    expect(ticketEntries(saleId)).toEqual(['sale.ticket_printed']);
  });

  it('asks by default when the register has no ticket design at all', async () => {
    const sales = new SaleStore(store, TENANT);
    const plain = new SalePayments(sales, new SaleCheckout({ hardware, sales, renderTicket: () => new Uint8Array() }), {
      printer: hardware.printer,
      businessName: () => 'Tlapalería',
    });

    expect(await plain.checkout(request(saveSaleOf100(), 10000))).toMatchObject({ ticket: 'ask' });
    expect(hardware.printer.jobs).toEqual([]);
  });
});
