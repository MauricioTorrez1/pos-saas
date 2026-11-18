import type { DashboardRefusal, PeriodKind } from './dashboard-api';

/**
 * The income statement of the register (E1-56, ADR 0072): what the business earned in a period before income tax, with
 * every amount without VAT, in cents. Only an owner sees it, or a cashier with the PIN of an owner.
 */

/** The periods of the summary, and «Desde el inicio»: from the first day with a sale, a return or an expense to today. */
export const STATEMENT_PERIOD_KINDS = ['day', 'week', 'month', 'year', 'custom', 'all'] as const;
export type StatementPeriodKind = PeriodKind | 'all';

export interface StatementRequest {
  readonly period: StatementPeriodKind;
  /** A day of the period as `YYYY-MM-DD`; for a custom range, the first day. Ignored for «Desde el inicio». */
  readonly date: string;
  /** For a custom range only: the last day, included. */
  readonly endDate?: string;
  /** The PIN of an owner, when a cashier asks (ADR 0047). */
  readonly ownerPin?: string;
}

/** One line of the statement: the amount and its share of the net sales. */
export interface StatementLine {
  readonly amountCents: number;
  /** The amount over the net sales in basis points, rounded half up; null when there are no net sales to compare with. */
  readonly shareBp: number | null;
}

/** The sales of one tax rate, before VAT. */
export interface TaxRateSales {
  /** `rate` with its rate, or `exempt` for goods without VAT. */
  readonly factor: 'rate' | 'exempt';
  readonly rateBp: number;
  readonly soldCents: number;
  readonly returnedCents: number;
  readonly netCents: number;
}

/** What one product cost to sell, or the rest of them gathered. */
export interface ProductCostLine {
  readonly name: string;
  readonly costCents: number;
  /** True for the line that gathers every product after the first ones. */
  readonly isRest: boolean;
}

/** The expenses of one concept. */
export interface ExpenseConceptLine {
  readonly concept: string;
  readonly amountCents: number;
  readonly count: number;
  /** The part that was paid from the drawer. */
  readonly fromDrawerCents: number;
}

export interface IncomeStatement {
  readonly period: {
    readonly kind: StatementPeriodKind;
    readonly fromDay: string;
    readonly toDay: string;
    readonly dayCount: number;
  };
  readonly generatedAt: string;
  /** False when nothing was sold, returned or spent in the period. */
  readonly hasActivity: boolean;
  /** What was sold, before VAT and before returns. */
  readonly grossSales: StatementLine;
  /** What was given back, before VAT. */
  readonly returns: StatementLine;
  /** Always zero: the register does not give discounts yet. */
  readonly discounts: StatementLine;
  readonly netSales: StatementLine;
  readonly costOfGoods: StatementLine;
  readonly grossProfit: StatementLine;
  readonly operatingExpenses: StatementLine;
  readonly operatingProfit: StatementLine;
  /** Before income tax: the register has no other income or financial costs, so it equals the operating profit. */
  readonly netProfit: StatementLine;
  /** The VAT charged minus the VAT given back. It belongs to the tax office, so it is never income. */
  readonly vatCollectedCents: number;
  /** Products sold without a known cost («Varios» included): their sales count, their cost does not. */
  readonly uncosted: { readonly productCount: number; readonly netSalesCents: number };
  readonly detail: {
    readonly byTaxRate: readonly TaxRateSales[];
    /** The products that cost the most, then «Otros productos». */
    readonly costByProduct: readonly ProductCostLine[];
    readonly expensesByConcept: readonly ExpenseConceptLine[];
  };
}

export type StatementResult =
  | { readonly status: 'ok'; readonly statement: IncomeStatement }
  /** A cashier asked without the PIN of an owner. */
  | { readonly status: 'authorization_required' }
  | DashboardRefusal;

/** The lines of the general view, in order. */
export type GeneralLineKey = 'netSales' | 'costOfGoods' | 'grossProfit' | 'operatingExpenses' | 'operatingProfit' | 'netProfit';

/** Each line of the general view with a name and a sentence a person who is not an accountant can read. */
export const GENERAL_LINES: readonly { readonly key: GeneralLineKey; readonly label: string; readonly explanation: string; readonly isResult: boolean }[] = [
  { key: 'netSales', label: 'Ventas netas', explanation: 'Lo que vendiste sin IVA, menos lo que devolviste.', isResult: false },
  { key: 'costOfGoods', label: '− Costo de lo vendido', explanation: 'Lo que te costó la mercancía que salió.', isResult: false },
  { key: 'grossProfit', label: '= Utilidad bruta', explanation: 'Lo que te deja vender, antes de pagar renta, luz o sueldos.', isResult: true },
  { key: 'operatingExpenses', label: '− Gastos de operación', explanation: 'Renta, luz, sueldos y lo demás que anotaste en «Gastos».', isResult: false },
  { key: 'operatingProfit', label: '= Utilidad de operación', explanation: 'Lo que gana el negocio con su trabajo de todos los días.', isResult: true },
  {
    key: 'netProfit',
    label: '= Utilidad neta (antes de ISR)',
    explanation: 'Lo que ganó el negocio antes del impuesto sobre la renta. Si sale negativa, en este periodo perdió.',
    isResult: true,
  },
];

/**
 * Names a tax rate the way the owner knows it.
 *
 * @param rate the factor and the rate in basis points
 * @returns text such as «Con IVA 16 %», «Tasa 0 %» or «Exentos de IVA»
 */
export function taxRateLabel(rate: Pick<TaxRateSales, 'factor' | 'rateBp'>): string {
  if (rate.factor === 'exempt') {
    return 'Exentos de IVA';
  }
  if (rate.rateBp === 0) {
    return 'Tasa 0 %';
  }
  const whole = Math.floor(rate.rateBp / 100);
  const rest = rate.rateBp % 100;
  return `Con IVA ${String(whole)}${rest === 0 ? '' : `.${String(rest).padStart(2, '0')}`} %`;
}
