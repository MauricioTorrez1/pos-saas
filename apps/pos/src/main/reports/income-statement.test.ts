import { describe, expect, it } from 'vitest';

import { taxRateLabel } from '../../shared/income-statement';
import { buildIncomeStatement, COST_DETAIL_LIMIT, shareOfNetSales, type ProductInput, type StatementInputs } from './income-statement';

const PERIOD = { kind: 'month', fromDay: '2026-11-01', toDay: '2026-11-30', dayCount: 30 } as const;

function inputs(overrides: Partial<StatementInputs> = {}): StatementInputs {
  return { period: PERIOD, generatedAt: '2026-11-18T18:00:00.000Z', rates: [], products: [], expenses: [], ...overrides };
}

function product(name: string, overrides: Partial<ProductInput> = {}): ProductInput {
  return { name, soldMilli: 0, returnedMilli: 0, soldSubtotalCents: 0, returnedSubtotalCents: 0, costE6: null, ...overrides };
}

const RATE_16 = { factor: 'rate', rateBp: 1600 } as const;

describe('buildIncomeStatement (ADR 0072)', () => {
  it('is all zeros for a period with no sales and no expenses, with no share to divide by', () => {
    const statement = buildIncomeStatement(inputs());

    expect(statement.hasActivity).toBe(false);
    expect(statement.netSales).toEqual({ amountCents: 0, shareBp: null });
    expect(statement.netProfit).toEqual({ amountCents: 0, shareBp: null });
    expect(statement.detail).toEqual({ byTaxRate: [], costByProduct: [], expensesByConcept: [] });
  });

  it('takes the returns out of the sales before VAT, and keeps the VAT apart because it is not income', () => {
    // 10,000 sold before VAT with 1,600 of VAT; 2,500 came back with 400 of VAT.
    const statement = buildIncomeStatement(
      inputs({
        rates: [{ ...RATE_16, soldSubtotalCents: 10_000, soldTaxCents: 1_600, returnedSubtotalCents: 2_500, returnedTaxCents: 400 }],
        products: [product('Martillo', { soldMilli: 4_000, returnedMilli: 1_000, soldSubtotalCents: 10_000, returnedSubtotalCents: 2_500, costE6: 15_000_000 })],
      }),
    );

    expect(statement.grossSales.amountCents).toBe(10_000);
    expect(statement.returns).toEqual({ amountCents: 2_500, shareBp: 3_333 });
    expect(statement.netSales).toEqual({ amountCents: 7_500, shareBp: 10_000 });
    expect(statement.vatCollectedCents).toBe(1_200);
    // Three net hammers at $15.00 cost 4,500, so 3,000 are left: 40 % of the net sales.
    expect(statement.costOfGoods).toEqual({ amountCents: 4_500, shareBp: 6_000 });
    expect(statement.grossProfit).toEqual({ amountCents: 3_000, shareBp: 4_000 });
  });

  it('subtracts the expenses once each and takes the profit before income tax', () => {
    const statement = buildIncomeStatement(
      inputs({
        rates: [{ ...RATE_16, soldSubtotalCents: 100_000, soldTaxCents: 16_000, returnedSubtotalCents: 0, returnedTaxCents: 0 }],
        products: [product('Pintura', { soldMilli: 10_000, soldSubtotalCents: 100_000, costE6: 60_000_000 })],
        expenses: [
          { concept: 'Luz', amountCents: 8_000, paidFromDrawer: true },
          { concept: 'Renta', amountCents: 20_000, paidFromDrawer: false },
          { concept: 'Luz', amountCents: 2_000, paidFromDrawer: false },
        ],
      }),
    );

    expect(statement.grossProfit.amountCents).toBe(40_000);
    expect(statement.operatingExpenses).toEqual({ amountCents: 30_000, shareBp: 3_000 });
    expect(statement.operatingProfit).toEqual({ amountCents: 10_000, shareBp: 1_000 });
    expect(statement.netProfit).toEqual(statement.operatingProfit);
    expect(statement.detail.expensesByConcept).toEqual([
      { concept: 'Renta', amountCents: 20_000, count: 1, fromDrawerCents: 0 },
      { concept: 'Luz', amountCents: 10_000, count: 2, fromDrawerCents: 8_000 },
    ]);
  });

  it('shows a loss as a negative profit with a negative share', () => {
    const statement = buildIncomeStatement(
      inputs({
        rates: [{ ...RATE_16, soldSubtotalCents: 1_000, soldTaxCents: 160, returnedSubtotalCents: 0, returnedTaxCents: 0 }],
        expenses: [{ concept: 'Renta', amountCents: 3_000, paidFromDrawer: false }],
      }),
    );

    expect(statement.operatingProfit).toEqual({ amountCents: -2_000, shareBp: -20_000 });
  });

  it('counts the sales of a product without cost, leaves its cost out and says how much it sold', () => {
    const statement = buildIncomeStatement(
      inputs({
        rates: [{ ...RATE_16, soldSubtotalCents: 3_000, soldTaxCents: 480, returnedSubtotalCents: 0, returnedTaxCents: 0 }],
        products: [
          product('Martillo', { soldMilli: 1_000, soldSubtotalCents: 2_000, costE6: 10_000_000 }),
          product('Varios (sin catálogo)', { soldMilli: 1_000, soldSubtotalCents: 1_000 }),
          product('Taquete sin vender'),
        ],
      }),
    );

    expect(statement.netSales.amountCents).toBe(3_000);
    expect(statement.costOfGoods.amountCents).toBe(1_000);
    expect(statement.uncosted).toEqual({ productCount: 1, netSalesCents: 1_000 });
  });

  it('lists the cost of the first products and gathers the rest in one line', () => {
    const products = Array.from({ length: COST_DETAIL_LIMIT + 2 }, (_, index) =>
      product(`Producto ${String(index + 1).padStart(2, '0')}`, { soldMilli: 1_000, soldSubtotalCents: 10_000, costE6: (index + 1) * 1_000_000 }),
    );

    const lines = buildIncomeStatement(inputs({ products })).detail.costByProduct;

    expect(lines).toHaveLength(COST_DETAIL_LIMIT + 1);
    expect(lines[0]).toEqual({ name: 'Producto 12', costCents: 1_200, isRest: false });
    // The two cheapest, $1.00 and $2.00, are the rest.
    expect(lines.at(-1)).toEqual({ name: 'Otros productos (2)', costCents: 300, isRest: true });
  });

  it('orders the tax rates from the highest to the exempt ones', () => {
    const zero = { soldTaxCents: 0, returnedSubtotalCents: 0, returnedTaxCents: 0 };
    const statement = buildIncomeStatement(
      inputs({
        rates: [
          { factor: 'exempt', rateBp: 0, soldSubtotalCents: 500, ...zero },
          { factor: 'rate', rateBp: 0, soldSubtotalCents: 300, ...zero },
          { factor: 'rate', rateBp: 1600, soldSubtotalCents: 1_000, ...zero },
          { factor: 'rate', rateBp: 800, soldSubtotalCents: 200, ...zero },
        ],
      }),
    );

    expect(statement.detail.byTaxRate.map(taxRateLabel)).toEqual(['Con IVA 16 %', 'Con IVA 8 %', 'Tasa 0 %', 'Exentos de IVA']);
    expect(statement.netSales.amountCents).toBe(2_000);
  });
});

describe('shareOfNetSales', () => {
  it('rounds half up in basis points', () => {
    expect(shareOfNetSales(1, 3)).toBe(3_333);
    expect(shareOfNetSales(2, 3)).toBe(6_667);
  });

  it('has no share without net sales, even when they are negative because of returns', () => {
    expect(shareOfNetSales(100, 0)).toBeNull();
    expect(shareOfNetSales(100, -50)).toBeNull();
  });
});
