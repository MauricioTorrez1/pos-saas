import { describe, expect, it } from 'vitest';

import { describePlan, readTypedCents } from './amount-input';

describe('readTypedCents', () => {
  it.each([
    ['50', 5000],
    ['50.00', 5000],
    ['40.94', 4094],
    ['0.5', 50],
    ['.5', 50],
    ['$50', 5000],
    ['1,250.50', 125050],
    ['  50  ', 5000],
    ['', 0],
    ['   ', 0],
  ])('reads %j as %i cents', (text, cents) => {
    expect(readTypedCents(text)).toBe(cents);
  });

  it.each([['abc'], ['5o'], ['-5'], ['1.234'], ['1e3'], ['50..0'], ['.'], ['99999999999999999999']])(
    'refuses %j',
    (text) => {
      expect(readTypedCents(text)).toBeNull();
    },
  );
});

describe('describePlan', () => {
  it('shows the change when the sale can be completed', () => {
    expect(describePlan({ status: 'ready', payments: [], changeCents: 906 })).toEqual({ tone: 'ready', text: 'Cambio $9.06' });
  });

  it('says the payment is exact when there is no change', () => {
    expect(describePlan({ status: 'ready', payments: [], changeCents: 0 })).toEqual({ tone: 'ready', text: 'Pago exacto' });
  });

  it('shows how much is missing', () => {
    expect(describePlan({ status: 'short', missingCents: 4094 })).toEqual({ tone: 'short', text: 'Faltan $40.94' });
  });

  it('explains each reason the payment cannot be recorded', () => {
    expect(describePlan({ status: 'transfers_exceed_total', excessCents: 100 }).text).toContain('No dan cambio');
    expect(describePlan({ status: 'cash_not_needed', excessCents: 500 }).text).toContain('Quita el efectivo');
    expect(describePlan({ status: 'reference_missing' }).text).toContain('referencia');
    expect(describePlan({ status: 'folio_missing' }).text).toContain('folio');
    expect(describePlan({ status: 'card_number_entered' }).text).toContain('número de tarjeta');
  });
});
