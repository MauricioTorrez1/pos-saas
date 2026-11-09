import { lineTotals, MoneyError, quantityOf, saleTotals, type LineTotals, type Quantity, type SaleTotals } from '@pos-saas/money';

import type { CatalogProduct } from '../../shared/pos-api';

const MILLI_PER_UNIT = 1000;

/** The message a cashier sees when a line would pass the largest amount the register can handle. */
export const AMOUNT_TOO_LARGE = 'El importe es demasiado grande para esta venta. Revisa la cantidad.';

/** One product of the sale. */
export interface SaleLine {
  readonly product: CatalogProduct;
  readonly quantity: Quantity;
  readonly totals: LineTotals;
}

/** The sale being rung up. */
export interface SaleState {
  /** One per product, in the order they were first added. */
  readonly lines: readonly SaleLine[];
  /** The product the arrow keys, + and −, and Delete act on. */
  readonly selectedProductId: string | null;
  readonly totals: SaleTotals;
  /** Why the last change could not be made, if it could not. */
  readonly problem: string | null;
}

/** What can happen to the sale. */
export type SaleAction =
  | { readonly type: 'add-product'; readonly product: CatalogProduct; readonly quantityMilli?: number }
  | { readonly type: 'change-quantity'; readonly units: 1 | -1 }
  | { readonly type: 'remove-selected' }
  | { readonly type: 'clear' }
  | { readonly type: 'move-selection'; readonly offset: 1 | -1 }
  | { readonly type: 'select'; readonly productId: string };

/** A sale with nothing in it yet. */
export const EMPTY_SALE: SaleState = {
  lines: [],
  selectedProductId: null,
  totals: saleTotals([]),
  problem: null,
};

/**
 * Applies a change to the sale. Lines that do not change keep their identity, so the screen only redraws the one that
 * did.
 *
 * @param sale the sale as it is
 * @param action what happened
 * @returns the sale after the change. A change that would pass the largest amount leaves the lines as they were and
 * sets `problem`.
 */
export function saleReducer(sale: SaleState, action: SaleAction): SaleState {
  switch (action.type) {
    case 'add-product':
      return addProduct(sale, action.product, action.quantityMilli ?? MILLI_PER_UNIT);
    case 'change-quantity':
      return changeSelectedQuantity(sale, action.units);
    case 'remove-selected':
      return removeSelected(sale);
    case 'clear':
      return EMPTY_SALE;
    case 'move-selection':
      return moveSelection(sale, action.offset);
    case 'select':
      return { ...sale, selectedProductId: action.productId, problem: null };
  }
}

function addProduct(sale: SaleState, product: CatalogProduct, milli: number): SaleState {
  const existing = sale.lines.find((line) => line.product.id === product.id);
  return withLines(sale, product.id, () =>
    existing === undefined
      ? [...sale.lines, buildLine(product, milli)]
      : replaceLine(sale.lines, existing, existing.quantity.milli + milli),
  );
}

function changeSelectedQuantity(sale: SaleState, units: 1 | -1): SaleState {
  const selected = selectedLine(sale);
  if (selected === undefined) {
    return sale;
  }
  const milli = selected.quantity.milli + units * MILLI_PER_UNIT;
  // Going below one unit would be a removal, and that takes its own key so it cannot happen by accident.
  if (milli < MILLI_PER_UNIT) {
    return sale;
  }
  return withLines(sale, selected.product.id, () => replaceLine(sale.lines, selected, milli));
}

function removeSelected(sale: SaleState): SaleState {
  const selected = selectedLine(sale);
  if (selected === undefined) {
    return sale;
  }
  const position = sale.lines.indexOf(selected);
  const lines = sale.lines.filter((line) => line !== selected);
  const nextSelected = lines[Math.min(position, lines.length - 1)];
  return withLines(sale, nextSelected?.product.id ?? null, () => lines);
}

function moveSelection(sale: SaleState, offset: 1 | -1): SaleState {
  if (sale.lines.length === 0) {
    return sale;
  }
  const selected = selectedLine(sale);
  const position = selected === undefined ? sale.lines.length : sale.lines.indexOf(selected);
  const nextPosition = Math.max(0, Math.min(position + offset, sale.lines.length - 1));
  return { ...sale, selectedProductId: sale.lines[nextPosition]!.product.id, problem: null };
}

function selectedLine(sale: SaleState): SaleLine | undefined {
  return sale.lines.find((line) => line.product.id === sale.selectedProductId);
}

function buildLine(product: CatalogProduct, milli: number): SaleLine {
  const quantity = quantityOf(milli, product.unit);
  return { product, quantity, totals: lineTotals(product.unitPriceE4, quantity, product.taxRate) };
}

function replaceLine(lines: readonly SaleLine[], line: SaleLine, milli: number): SaleLine[] {
  return lines.map((current) => (current === line ? buildLine(line.product, milli) : current));
}

/** The line and the sale are recalculated together, so a change that overflows either one leaves both untouched. */
function withLines(sale: SaleState, selectedProductId: string | null, buildLines: () => readonly SaleLine[]): SaleState {
  try {
    const lines = buildLines();
    return { lines, selectedProductId, totals: saleTotals(lines.map((line) => line.totals)), problem: null };
  } catch (error) {
    if (error instanceof MoneyError) {
      return { ...sale, problem: AMOUNT_TOO_LARGE };
    }
    throw error;
  }
}
