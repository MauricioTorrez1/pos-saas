import { sumCents } from '@pos-saas/money';
import { describe, expect, it } from 'vitest';

import { planPayments, type PaymentPlan, type PaymentTender } from './payment-plan';

const TRANSFER_REFERENCE = 'SPEI-778812';
/** Built from parts, so the secret scan does not take a test value for a real card number. */
const SAMPLE_CARD = ['4111', '1111', '1111', '1111'];

function cash(cashReceivedCents: number): PaymentTender {
  return { cashReceivedCents, transfers: [] };
}

function transfer(amountCents: number, reference: string = TRANSFER_REFERENCE): PaymentTender {
  return { cashReceivedCents: 0, transfers: [{ amountCents, reference }] };
}

function mixed(cashReceivedCents: number, amountCents: number): PaymentTender {
  return { cashReceivedCents, transfers: [{ amountCents, reference: TRANSFER_REFERENCE }] };
}

describe('planPayments', () => {
  it('gives $9.06 of change for $50.00 against $40.94 (RF-014)', () => {
    expect(planPayments(4094, cash(5000))).toEqual({
      status: 'ready',
      payments: [{ method: 'cash', amountCents: 4094, tenderedCents: 5000 }],
      changeCents: 906,
    });
  });

  it('records $60 in cash and $40 by transfer as two parts of $100 (RF-015)', () => {
    expect(planPayments(10000, mixed(6000, 4000))).toEqual({
      status: 'ready',
      payments: [
        { method: 'cash', amountCents: 6000, tenderedCents: 6000 },
        { method: 'transfer', amountCents: 4000, reference: TRANSFER_REFERENCE },
      ],
      changeCents: 0,
    });
  });

  it('takes the exact amount in cash', () => {
    expect(planPayments(11600, cash(11600))).toMatchObject({ status: 'ready', changeCents: 0 });
  });

  it('takes the whole sale by transfer, with no cash part', () => {
    expect(planPayments(11600, transfer(11600))).toEqual({
      status: 'ready',
      payments: [{ method: 'transfer', amountCents: 11600, reference: TRANSFER_REFERENCE }],
      changeCents: 0,
    });
  });

  it('gives the change of a mixed payment out of the cash, and records only what the cash paid', () => {
    expect(planPayments(10000, mixed(10000, 4000))).toEqual({
      status: 'ready',
      payments: [
        { method: 'cash', amountCents: 6000, tenderedCents: 10000 },
        { method: 'transfer', amountCents: 4000, reference: TRANSFER_REFERENCE },
      ],
      changeCents: 4000,
    });
  });

  it('accepts several transfers', () => {
    const tender: PaymentTender = {
      cashReceivedCents: 0,
      transfers: [
        { amountCents: 7000, reference: 'first' },
        { amountCents: 3000, reference: 'second' },
      ],
    };

    expect(planPayments(10000, tender)).toMatchObject({
      status: 'ready',
      payments: [
        { method: 'transfer', amountCents: 7000, reference: 'first' },
        { method: 'transfer', amountCents: 3000, reference: 'second' },
      ],
    });
  });

  it('keeps a reference without the spaces around it', () => {
    expect(planPayments(100, transfer(100, '  ABC 123 '))).toMatchObject({
      payments: [{ method: 'transfer', reference: 'ABC 123' }],
    });
  });

  it('says how much is missing when nothing was received', () => {
    expect(planPayments(4094, cash(0))).toEqual({ status: 'short', missingCents: 4094 });
  });

  it('says how much is missing when the cash does not reach the total', () => {
    expect(planPayments(4094, cash(4093))).toEqual({ status: 'short', missingCents: 1 });
  });

  it('says how much is missing when cash and transfer together do not reach the total', () => {
    expect(planPayments(10000, mixed(5000, 4000))).toEqual({ status: 'short', missingCents: 1000 });
  });

  it('refuses a transfer for more than the total, because a transfer gives no change', () => {
    expect(planPayments(10000, transfer(10001))).toEqual({ status: 'transfers_exceed_total', excessCents: 1 });
  });

  it('refuses cash that nothing needs, because all of it would come back as change', () => {
    expect(planPayments(10000, mixed(500, 10000))).toEqual({ status: 'cash_not_needed', excessCents: 500 });
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
  ])('asks for the reference of a transfer when it is %s', (_case, reference) => {
    expect(planPayments(100, transfer(100, reference))).toEqual({ status: 'reference_missing' });
  });

  it('says what is missing before asking for the reference', () => {
    expect(planPayments(10000, transfer(4000, ''))).toEqual({ status: 'short', missingCents: 6000 });
  });

  describe('card typed on the standalone terminal (RF-016)', () => {
    function withCard(cashReceivedCents: number, amountCents: number, reference: string): PaymentTender {
      return { cashReceivedCents, transfers: [], cards: [{ amountCents, reference }] };
    }

    it('records the card as card_manual with its folio, next to the cash', () => {
      expect(planPayments(10000, withCard(6000, 4000, 'A48291'))).toEqual({
        status: 'ready',
        payments: [
          { method: 'cash', amountCents: 6000, tenderedCents: 6000 },
          { method: 'card_manual', amountCents: 4000, reference: 'A48291' },
        ],
        changeCents: 0,
      });
    });

    it('takes the whole sale on the card', () => {
      expect(planPayments(11600, withCard(0, 11600, '482913'))).toMatchObject({
        status: 'ready',
        payments: [{ method: 'card_manual', amountCents: 11600, reference: '482913' }],
      });
    });

    it('puts the cash first, then the transfers, then the cards, and the change comes only from the cash', () => {
      const tender: PaymentTender = {
        cashReceivedCents: 5000,
        transfers: [{ amountCents: 3000, reference: 'SPEI-1' }],
        cards: [{ amountCents: 4000, reference: '4829' }],
      };

      expect(planPayments(10000, tender)).toMatchObject({
        status: 'ready',
        payments: [
          { method: 'cash', amountCents: 3000 },
          { method: 'transfer', amountCents: 3000 },
          { method: 'card_manual', amountCents: 4000 },
        ],
        changeCents: 2000,
      });
    });

    it('asks for the folio, because without it the card cannot be reconciled later', () => {
      expect(planPayments(10000, withCard(0, 10000, ' '))).toEqual({ status: 'folio_missing' });
    });

    it.each([[SAMPLE_CARD.join('')], [SAMPLE_CARD.join(' ')], [SAMPLE_CARD.join('-')], [['5555', '5555', '5555', '4444'].join('')], ['1234567890123']])(
      'refuses %j, because it looks like a card number and the register never keeps one',
      (reference) => {
        expect(planPayments(10000, withCard(0, 10000, reference))).toEqual({ status: 'card_number_entered' });
      },
    );

    it.each([['A48291'], ['482913'], ['000123456789'], ['AUT 77 12']])('accepts the folio %j', (reference) => {
      expect(planPayments(10000, withCard(0, 10000, reference)).status).toBe('ready');
    });

    it('treats a card like a transfer: it gives no change, so it cannot pass the total', () => {
      expect(planPayments(10000, withCard(0, 10001, '4829'))).toEqual({ status: 'transfers_exceed_total', excessCents: 1 });
    });

    it('says how much is missing, before it asks for the folio', () => {
      expect(planPayments(10000, withCard(0, 4000, ''))).toEqual({ status: 'short', missingCents: 6000 });
    });
  });

  it('always adds up to the total, and the change never passes the cash received', () => {
    const totals = [1, 2, 99, 100, 101, 4094, 10000, 15694, 999_999];
    const parts = [0, 1, 50, 99, 100, 2500, 4094, 10000, 1_000_000];

    let readyPlans = 0;
    for (const totalCents of totals) {
      for (const cashReceivedCents of parts) {
        for (const amountCents of parts.filter((part) => part > 0)) {
          const plan: PaymentPlan = planPayments(totalCents, mixed(cashReceivedCents, amountCents));
          if (plan.status === 'ready') {
            readyPlans += 1;
            expect(sumCents(plan.payments.map((payment) => payment.amountCents))).toBe(totalCents);
            expect(plan.changeCents).toBe(cashReceivedCents + amountCents - totalCents);
            expect(plan.changeCents).toBeLessThanOrEqual(cashReceivedCents);
            expect(plan.payments.every((payment) => payment.amountCents > 0)).toBe(true);
          }
        }
      }
    }
    // Guards against a loop that never reaches a ready plan and passes for that reason.
    expect(readyPlans).toBeGreaterThan(100);
  });
});
