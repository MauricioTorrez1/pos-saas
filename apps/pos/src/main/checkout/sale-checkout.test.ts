import { describe, expect, it } from 'vitest';

import { DeviceError } from '../hardware/device-error';
import { createFakeHardware, type FakeHardware } from '../hardware/fakes/fake-hardware';
import { InMemorySaleRecorder } from './in-memory-sale-recorder';
import { SaleCheckout } from './sale-checkout';
import { SaleAlreadyCompletedError, type SalePayment, type SaleToCheckout } from './sale-recorder';

const CASH_SALE: SaleToCheckout = {
  saleId: '019a5f2e-7c40-7b1a-9d2e-3f4a5b6c7d8e',
  idempotencyKey: '019a5f2e-7c41-7000-8000-000000000001',
  lines: [],
  subtotalCents: 4849,
  taxCents: 776,
  totalCents: 5625,
  payment: { kind: 'in_person', payments: [{ method: 'cash', amountCents: 5625, reference: null }], changeCents: 375 },
};
const CARD_SALE: SaleToCheckout = { ...CASH_SALE, payment: { kind: 'card' } };
const CASH_PAYMENT: SalePayment = { method: 'cash', amountCents: 5625, reference: null };

/** A stand-in for the ESC/POS generator of E1-13: plain text, so a failing test is easy to read. */
function renderPlainTicket(sale: SaleToCheckout, payments: readonly SalePayment[]): Uint8Array {
  const paidWith = payments.map((payment) => ` ${payment.amountCents} ${payment.reference ?? ''}`.trim()).join(', ');
  return new TextEncoder().encode(`Venta ${sale.saleId}\nTotal ${sale.totalCents} centavos\nPago: ${paidWith}\n`);
}

function setUpRegister(): { hardware: FakeHardware; sales: InMemorySaleRecorder; checkout: SaleCheckout } {
  const hardware = createFakeHardware();
  const sales = new InMemorySaleRecorder(hardware.log);
  const checkout = new SaleCheckout({ hardware, sales, renderTicket: renderPlainTicket });
  return { hardware, sales, checkout };
}

describe('SaleCheckout with every device faked', () => {
  it('sells nails by weight for cash, from the scale to the ticket', async () => {
    const { hardware, sales, checkout } = setUpRegister();
    hardware.scale.placeOnScale(1250);

    // The sale screen of E1-07 and E1-08 will do this part, and E1-05 will calculate the total.
    const weightMilli = await hardware.scale.readWeightMilli();
    const result = await checkout.checkout(CASH_SALE);

    expect(weightMilli).toBe(1250);
    expect(result).toEqual({ status: 'completed', payments: [CASH_PAYMENT], changeCents: 375, problems: [] });
    expect(hardware.log.entries).toEqual([
      'scale.readWeightMilli',
      'sales.savePendingPayment',
      'sales.markCompleted',
      'cashDrawer.open',
      'printer.print',
    ]);
    expect(sales.find(CASH_SALE.saleId)?.status).toBe('completed');
    expect(hardware.cashDrawer.openCount).toBe(1);
    expect(hardware.cardTerminal.charges).toEqual([]);
    expect(hardware.printer.printedBytes()).toEqual(renderPlainTicket(CASH_SALE, [CASH_PAYMENT]));
  });

  it('charges a card after saving the sale and before completing it, and keeps only the authorization code', async () => {
    const { hardware, sales, checkout } = setUpRegister();
    hardware.cardTerminal.willRespond({ status: 'approved', authorizationCode: '482913' });

    const result = await checkout.checkout(CARD_SALE);

    const payments = [{ method: 'card', amountCents: 5625, reference: '482913' }] as const;
    expect(result).toEqual({ status: 'completed', payments, changeCents: 0, problems: [] });
    expect(hardware.log.entries).toEqual([
      'sales.savePendingPayment',
      'cardTerminal.charge',
      'sales.markCompleted',
      'printer.print',
    ]);
    expect(hardware.cardTerminal.charges).toEqual([
      { saleId: CARD_SALE.saleId, idempotencyKey: CARD_SALE.idempotencyKey, amountCents: 5625 },
    ]);
    expect(sales.find(CARD_SALE.saleId)).toMatchObject({ status: 'completed', payments });
    expect(hardware.cashDrawer.openCount).toBe(0);
    expect(hardware.printer.printedBytes()).toEqual(renderPlainTicket(CARD_SALE, payments));
  });

  it('leaves a declined card sale pending, with the drawer closed and nothing printed', async () => {
    const { hardware, sales, checkout } = setUpRegister();
    hardware.cardTerminal.willRespond({ status: 'declined', reason: 'Fondos insuficientes' });

    const result = await checkout.checkout(CARD_SALE);

    expect(result).toEqual({ status: 'declined', reason: 'Fondos insuficientes' });
    expect(sales.find(CARD_SALE.saleId)?.status).toBe('pending_payment');
    expect(hardware.cashDrawer.openCount).toBe(0);
    expect(hardware.printer.jobs).toEqual([]);
  });

  it('lets the cashier pay with cash after a declined card', async () => {
    const { hardware, sales, checkout } = setUpRegister();
    hardware.cardTerminal.willRespond({ status: 'declined', reason: 'Fondos insuficientes' });

    await checkout.checkout(CARD_SALE);
    const result = await checkout.checkout({ ...CASH_SALE, idempotencyKey: '019a5f2e-7c41-7000-8000-000000000002' });

    expect(result.status).toBe('completed');
    expect(sales.find(CASH_SALE.saleId)).toMatchObject({ status: 'completed', payments: [CASH_PAYMENT] });
    expect(hardware.cashDrawer.openCount).toBe(1);
  });

  it('charges nothing and opens nothing when the sale cannot be saved', async () => {
    const { hardware, sales, checkout } = setUpRegister();
    sales.failNextWith(new Error('disk full'));

    await expect(checkout.checkout(CARD_SALE)).rejects.toThrow('disk full');

    expect(hardware.cardTerminal.charges).toEqual([]);
    expect(hardware.cashDrawer.openCount).toBe(0);
    expect(hardware.printer.jobs).toEqual([]);
  });

  it('keeps the sale pending when the card terminal cannot be reached', async () => {
    const { hardware, sales, checkout } = setUpRegister();
    hardware.cardTerminal.failNextWith();

    await expect(checkout.checkout(CARD_SALE)).rejects.toThrow(DeviceError);

    expect(sales.find(CARD_SALE.saleId)?.status).toBe('pending_payment');
    expect(hardware.printer.jobs).toEqual([]);
  });

  it('never charges a completed sale again', async () => {
    const { hardware, checkout } = setUpRegister();

    await checkout.checkout(CARD_SALE);
    await expect(checkout.checkout({ ...CARD_SALE, idempotencyKey: 'another-attempt' })).rejects.toThrow(
      SaleAlreadyCompletedError,
    );

    expect(hardware.cardTerminal.charges).toHaveLength(1);
  });

  it('refuses a total with decimals before saving anything', async () => {
    const { hardware, checkout } = setUpRegister();

    await expect(checkout.checkout({ ...CASH_SALE, totalCents: 56.25 })).rejects.toThrow(RangeError);

    expect(hardware.log.entries).toEqual([]);
  });

  it('reports a printer without paper, and still completes the sale and opens the drawer', async () => {
    const { hardware, sales, checkout } = setUpRegister();
    hardware.printer.failNextWith();

    const result = await checkout.checkout(CASH_SALE);

    expect(result).toEqual({
      status: 'completed',
      payments: [CASH_PAYMENT],
      changeCents: 375,
      problems: [{ device: 'printer', message: 'The printer is out of paper' }],
    });
    expect(sales.find(CASH_SALE.saleId)?.status).toBe('completed');
    expect(hardware.cashDrawer.openCount).toBe(1);
  });

  it('still prints the ticket when the drawer does not open', async () => {
    const { hardware, checkout } = setUpRegister();
    hardware.cashDrawer.failNextWith();

    const result = await checkout.checkout(CASH_SALE);

    expect(result).toMatchObject({ status: 'completed', problems: [{ device: 'cashDrawer' }] });
    expect(hardware.printer.jobs).toHaveLength(1);
  });

  it('opens the drawer and records every part of a mixed payment, with the change out of the cash', async () => {
    const { hardware, sales, checkout } = setUpRegister();
    const payments: SalePayment[] = [
      { method: 'cash', amountCents: 3625, reference: null },
      { method: 'transfer', amountCents: 2000, reference: 'SPEI-778812' },
    ];

    const result = await checkout.checkout({ ...CASH_SALE, payment: { kind: 'in_person', payments, changeCents: 1375 } });

    expect(result).toEqual({ status: 'completed', payments, changeCents: 1375, problems: [] });
    expect(sales.find(CASH_SALE.saleId)).toMatchObject({ status: 'completed', payments });
    expect(hardware.cashDrawer.openCount).toBe(1);
  });

  it('keeps the drawer closed when nothing was paid in cash', async () => {
    const { hardware, checkout } = setUpRegister();
    const payments: SalePayment[] = [{ method: 'transfer', amountCents: 5625, reference: 'SPEI-778812' }];

    await checkout.checkout({ ...CASH_SALE, payment: { kind: 'in_person', payments, changeCents: 0 } });

    expect(hardware.cashDrawer.openCount).toBe(0);
    expect(hardware.printer.jobs).toHaveLength(1);
  });

  it.each([
    ['less than', 5624],
    ['more than', 5626],
  ])('saves nothing when the payments add up to %s the total', async (_case, amountCents) => {
    const { hardware, checkout } = setUpRegister();
    const payments: SalePayment[] = [{ method: 'cash', amountCents, reference: null }];

    await expect(
      checkout.checkout({ ...CASH_SALE, payment: { kind: 'in_person', payments, changeCents: 0 } }),
    ).rejects.toThrow(RangeError);

    expect(hardware.log.entries).toEqual([]);
  });
});