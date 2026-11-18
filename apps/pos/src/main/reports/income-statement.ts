import type {
  ExpenseConceptLine,
  IncomeStatement,
  ProductCostLine,
  StatementLine,
  TaxRateSales,
} from '../../shared/income-statement';
import { costInCents, divideHalfUp } from './average-cost';

/** How many products the detail of the cost lists before gathering the rest. */
export const COST_DETAIL_LIMIT = 10;

const REST_NAME = 'Otros productos';

/** The sales and returns of one tax rate, as the database adds them up. */
export interface RateInput {
  readonly factor: 'rate' | 'exempt';
  readonly rateBp: number;
  readonly soldSubtotalCents: number;
  readonly soldTaxCents: number;
  readonly returnedSubtotalCents: number;
  readonly returnedTaxCents: number;
}

/** What one product sold and gave back in the period, and its cost per unit if anybody knows it. */
export interface ProductInput {
  readonly name: string;
  readonly soldMilli: number;
  readonly returnedMilli: number;
  readonly soldSubtotalCents: number;
  readonly returnedSubtotalCents: number;
  /** Cost per unit in millionths of a peso, or null when it is not known. */
  readonly costE6: number | null;
}

/** One expense that counts: not voided, and its day inside the period. */
export interface ExpenseInput {
  readonly concept: string;
  readonly amountCents: number;
  readonly paidFromDrawer: boolean;
}

export interface StatementInputs {
  readonly period: IncomeStatement['period'];
  readonly generatedAt: string;
  readonly rates: readonly RateInput[];
  readonly products: readonly ProductInput[];
  readonly expenses: readonly ExpenseInput[];
}

/**
 * The share of an amount in the net sales, in basis points rounded half up, keeping the sign of the amount.
 *
 * @param amountCents the amount
 * @param netSalesCents the net sales
 * @returns basis points, or null when there are no net sales to divide by
 */
export function shareOfNetSales(amountCents: number, netSalesCents: number): number | null {
  if (netSalesCents <= 0) {
    return null;
  }
  const magnitude = Number(divideHalfUp(BigInt(Math.abs(amountCents)) * 10_000n, BigInt(netSalesCents)));
  return amountCents < 0 ? -magnitude : magnitude;
}

function costByProduct(products: readonly ProductInput[]): ProductCostLine[] {
  const lines = products
    .filter((product) => product.costE6 !== null)
    .map((product) => ({
      name: product.name,
      costCents: costInCents(product.soldMilli, product.costE6!) - costInCents(product.returnedMilli, product.costE6!),
    }))
    .filter((line) => line.costCents !== 0)
    .sort((a, b) => b.costCents - a.costCents || a.name.localeCompare(b.name, 'es'));
  const first: ProductCostLine[] = lines.slice(0, COST_DETAIL_LIMIT).map((line) => ({ ...line, isRest: false }));
  const rest = lines.slice(COST_DETAIL_LIMIT);
  if (rest.length > 0) {
    first.push({ name: `${REST_NAME} (${String(rest.length)})`, costCents: rest.reduce((sum, line) => sum + line.costCents, 0), isRest: true });
  }
  return first;
}

function expensesByConcept(expenses: readonly ExpenseInput[]): ExpenseConceptLine[] {
  const byConcept = new Map<string, { amountCents: number; count: number; fromDrawerCents: number }>();
  for (const expense of expenses) {
    const line = byConcept.get(expense.concept) ?? { amountCents: 0, count: 0, fromDrawerCents: 0 };
    line.amountCents += expense.amountCents;
    line.count += 1;
    line.fromDrawerCents += expense.paidFromDrawer ? expense.amountCents : 0;
    byConcept.set(expense.concept, line);
  }
  return [...byConcept.entries()]
    .map(([concept, line]) => ({ concept, ...line }))
    .sort((a, b) => b.amountCents - a.amountCents || a.concept.localeCompare(b.concept, 'es'));
}

function byTaxRate(rates: readonly RateInput[]): TaxRateSales[] {
  return [...rates]
    .map((rate) => ({
      factor: rate.factor,
      rateBp: rate.rateBp,
      soldCents: rate.soldSubtotalCents,
      returnedCents: rate.returnedSubtotalCents,
      netCents: rate.soldSubtotalCents - rate.returnedSubtotalCents,
    }))
    .sort((a, b) => (a.factor === b.factor ? b.rateBp - a.rateBp : a.factor === 'rate' ? -1 : 1));
}

/**
 * Builds the income statement from what the database added up. Everything is integer cents without VAT:
 *
 * - net sales = sales − returns − discounts;
 * - gross profit = net sales − cost of the net units whose cost is known;
 * - operating profit = gross profit − the expenses of the period;
 * - net profit, before income tax, equals the operating profit.
 *
 * Products without a cost add to the sales and not to the cost, so the profit comes out higher than the real one; the
 * statement says how many there are and how much they sold, instead of guessing their cost.
 *
 * @param inputs the period, the sales by rate, the products and the expenses
 * @returns the statement
 */
export function buildIncomeStatement(inputs: StatementInputs): IncomeStatement {
  let grossSalesCents = 0;
  let returnsCents = 0;
  let vatCollectedCents = 0;
  for (const rate of inputs.rates) {
    grossSalesCents += rate.soldSubtotalCents;
    returnsCents += rate.returnedSubtotalCents;
    vatCollectedCents += rate.soldTaxCents - rate.returnedTaxCents;
  }
  const discountsCents = 0;
  const netSalesCents = grossSalesCents - returnsCents - discountsCents;

  let costOfGoodsCents = 0;
  let uncostedCount = 0;
  let uncostedNetSalesCents = 0;
  for (const product of inputs.products) {
    if (product.costE6 === null) {
      if (product.soldMilli > 0 || product.returnedMilli > 0) {
        uncostedCount += 1;
        uncostedNetSalesCents += product.soldSubtotalCents - product.returnedSubtotalCents;
      }
      continue;
    }
    costOfGoodsCents += costInCents(product.soldMilli, product.costE6) - costInCents(product.returnedMilli, product.costE6);
  }
  const operatingExpensesCents = inputs.expenses.reduce((sum, expense) => sum + expense.amountCents, 0);
  const grossProfitCents = netSalesCents - costOfGoodsCents;
  const operatingProfitCents = grossProfitCents - operatingExpensesCents;
  const line = (amountCents: number): StatementLine => ({ amountCents, shareBp: shareOfNetSales(amountCents, netSalesCents) });

  return {
    period: inputs.period,
    generatedAt: inputs.generatedAt,
    hasActivity: inputs.rates.some((rate) => rate.soldSubtotalCents !== 0 || rate.returnedSubtotalCents !== 0 || rate.soldTaxCents !== 0) || inputs.expenses.length > 0,
    grossSales: line(grossSalesCents),
    returns: line(returnsCents),
    discounts: line(discountsCents),
    netSales: line(netSalesCents),
    costOfGoods: line(costOfGoodsCents),
    grossProfit: line(grossProfitCents),
    operatingExpenses: line(operatingExpensesCents),
    operatingProfit: line(operatingProfitCents),
    netProfit: line(operatingProfitCents),
    vatCollectedCents,
    uncosted: { productCount: uncostedCount, netSalesCents: uncostedNetSalesCents },
    detail: {
      byTaxRate: byTaxRate(inputs.rates),
      costByProduct: costByProduct(inputs.products),
      expensesByConcept: expensesByConcept(inputs.expenses),
    },
  };
}
