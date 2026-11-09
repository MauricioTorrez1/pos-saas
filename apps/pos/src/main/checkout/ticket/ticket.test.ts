import { lineTotals, quantityOf, saleTotals, taxRateOf } from '@pos-saas/money';
import { describe, expect, it } from 'vitest';

import { EscPosBuilder } from './escpos';
import { formatFolio, layoutTicket, renderTicket, TICKET_COLUMNS, type TicketData } from './ticket';

const SIXTEEN = taxRateOf('rate', 1600);
const EXEMPT = taxRateOf('exempt', 0);

function ticketLine(name: string, milli: number, unit: 'piece' | 'meter', unitPriceE4: number, taxRate = SIXTEEN): TicketData['lines'][number] {
  const quantity = quantityOf(milli, unit);
  return { name, quantity, unitPriceE4, totalCents: lineTotals(unitPriceE4, quantity, taxRate).totalCents };
}

function aTicket(overrides: Partial<TicketData> = {}): TicketData {
  const lines = [ticketLine('Cable THW', 3275, 'meter', 125_000), ticketLine('Martillo uña curva 16 oz', 1000, 'piece', 1_160_000)];
  const { subtotalCents, taxGroups, totalCents } = saleTotals(
    lines.map((line) => ({ totalCents: line.totalCents, taxRate: SIXTEEN })),
  );
  return {
    businessName: 'Tlapalería Torres',
    folio: 'T1-000123',
    completedAt: '2026-11-08T20:05:00.000Z',
    lines,
    subtotalCents,
    taxGroups,
    totalCents,
    payments: [
      { method: 'cash', amountCents: 10000, reference: null },
      { method: 'transfer', amountCents: totalCents - 10000, reference: 'SPEI-778812' },
    ],
    changeCents: 0,
    isReprint: false,
    ...overrides,
  };
}

describe('formatFolio', () => {
  it('writes the short folio of a sale with the code of the register and six digits', () => {
    expect(formatFolio(123)).toBe('T1-000123');
    expect(formatFolio(1)).toBe('T1-000001');
    expect(formatFolio(1_234_567)).toBe('T1-1234567');
  });

  it.each([[0], [-1], [1.5]])('refuses %s', (number) => {
    expect(() => formatFolio(number)).toThrow(RangeError);
  });
});

describe('layoutTicket', () => {
  it('never passes the width of the paper, even with a long name and a large amount', () => {
    const long = ticketLine('Tornillo para madera de cabeza plana cincado de 2 pulgadas caja mayoreo', 1000, 'piece', 99_999_900);

    const lines = layoutTicket(aTicket({ lines: [long], businessName: 'Tlapalería y Ferretería La Esperanza del Centro S.A.' }));

    expect(lines.every((line) => [...line].length <= TICKET_COLUMNS)).toBe(true);
  });

  it('shows the business, the folio, and the date', () => {
    const lines = layoutTicket(aTicket());

    expect(lines[0]).toContain('Tlapalería Torres');
    expect(lines.join('\n')).toContain('Folio T1-000123');
    expect(lines.join('\n')).toMatch(/2026/);
  });

  it('shows each product with its quantity, its unit price, and its amount', () => {
    const text = layoutTicket(aTicket()).join('\n');

    expect(text).toMatch(/Cable THW\s+\$40\.94/);
    expect(text).toContain('3.275 m x $12.50');
    expect(text).toMatch(/Martillo uña curva 16 oz\s+\$116\.00/);
    expect(text).toContain('1 pza x $116.00');
  });

  it('shows the base, the VAT of each rate, and the total', () => {
    const text = layoutTicket(aTicket()).join('\n');

    expect(text).toMatch(/Subtotal\s+\$135\.29/);
    expect(text).toMatch(/IVA 16%\s+\$21\.65/);
    expect(text).toMatch(/TOTAL\s+\$156\.94/);
  });

  it('says Sin IVA for exempt products and lists each rate on its own line', () => {
    const exempt = ticketLine('Libro', 1000, 'piece', 700_000, EXEMPT);
    const lines = [ticketLine('Martillo', 1000, 'piece', 1_160_000), exempt];
    const { subtotalCents, taxGroups, totalCents } = saleTotals([
      { totalCents: lines[0]!.totalCents, taxRate: SIXTEEN },
      { totalCents: exempt.totalCents, taxRate: EXEMPT },
    ]);

    const text = layoutTicket(aTicket({ lines, subtotalCents, taxGroups, totalCents, payments: [{ method: 'cash', amountCents: totalCents, reference: null }] })).join('\n');

    expect(text).toMatch(/IVA 16%\s+\$16\.00/);
    expect(text).toMatch(/Exento\s+Sin IVA/);
  });

  it('shows each payment, with the reference of a transfer and the change', () => {
    const text = layoutTicket(aTicket({ payments: [{ method: 'cash', amountCents: 15694, reference: null }], changeCents: 4306 })).join('\n');

    expect(text).toMatch(/Efectivo\s+\$156\.94/);
    expect(text).toMatch(/Cambio\s+\$43\.06/);
    expect(layoutTicket(aTicket()).join('\n')).toMatch(/Transferencia SPEI-778812\s+\$56\.94/);
  });

  it('leaves out the change when there is none, and when it is unknown on a reprint', () => {
    expect(layoutTicket(aTicket()).join('\n')).not.toContain('Cambio');
    expect(layoutTicket(aTicket({ changeCents: null, isReprint: true })).join('\n')).not.toContain('Cambio');
  });

  it('marks a reprint, so it cannot pass for the original', () => {
    expect(layoutTicket(aTicket({ isReprint: true })).join('\n')).toContain('REIMPRESIÓN');
    expect(layoutTicket(aTicket()).join('\n')).not.toContain('REIMPRESIÓN');
  });

  it('shows the authorization code of a card, and nothing else about it', () => {
    const text = layoutTicket(aTicket({ payments: [{ method: 'card', amountCents: 15694, reference: '482913' }] })).join('\n');

    expect(text).toMatch(/Tarjeta folio 482913\s+\$156\.94/);
  });
});

describe('renderTicket', () => {
  it('starts with a reset, ends with a cut, and has the text of the layout between them', () => {
    const bytes = renderTicket(aTicket());

    expect([...bytes.slice(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
    expect([...bytes.slice(-4)]).toEqual([0x1d, 0x56, 0x42, 0]);
    const readable = new TextDecoder('latin1').decode(bytes);
    expect(readable).toContain('Cable THW');
    expect(readable).toContain('TOTAL');
  });

  it('prints the same bytes for the same sale, so a reprint matches the original', () => {
    expect([...renderTicket(aTicket())]).toEqual([...renderTicket(aTicket())]);
  });

  it('is built with the same commands as the builder', () => {
    const expected = new EscPosBuilder().initialize().toBytes();

    expect([...renderTicket(aTicket()).slice(0, expected.length)]).toEqual([...expected]);
  });
});
