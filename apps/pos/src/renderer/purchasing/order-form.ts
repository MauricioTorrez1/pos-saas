import { MoneyError, parseQuantity, type Unit } from '@pos-saas/money';

import { readUnitCost, unitCostText } from '../../shared/product-admin';
import {
  MAX_ORDER_QUANTITY_MILLI,
  orderLineCents,
  type OrderCandidate,
  type OrderLine,
  type OrderLineRequest,
  type OwnerRefusalResult,
  type SupplierCode,
} from '../../shared/supplier-order';

const MILLI_PER_UNIT = 1000;
const MILLI_DECIMALS = 3;

/** A line of the order as the person edits it: the boxes hold what was typed, and nothing is a number until it is read. */
export interface DraftLine {
  /** Tells the lines apart while they are edited. It is not saved. */
  readonly key: string;
  readonly productId: string;
  readonly description: string;
  readonly barcode: string | null;
  readonly unit: Unit;
  /** The codes this supplier gives to the product, which the line can print. */
  readonly supplierCodes: readonly SupplierCode[];
  /** The code printed on the line, or null. */
  readonly supplierCode: string | null;
  readonly quantityText: string;
  readonly costText: string;
  /** What the shelf has now, to show next to the quantity. Null for a line of an order loaded from disk. */
  readonly stockMilli: number | null;
  readonly minimumMilli: number | null;
  readonly maximumMilli: number | null;
  readonly suggestedMilli: number | null;
}

let nextKey = 0;

function newKey(): string {
  nextKey += 1;
  return `line-${nextKey}`;
}

/**
 * Writes a quantity the way a person types it: whole for pieces, and with the decimals it needs for what is measured.
 *
 * @param quantityMilli the quantity in thousandths of the unit
 * @param unit the unit
 * @returns text such as "12" or "2.5"
 */
export function quantityInputText(quantityMilli: number, unit: Unit): string {
  const thousandths = quantityMilli % MILLI_PER_UNIT;
  const whole = (quantityMilli - thousandths) / MILLI_PER_UNIT;
  if (unit === 'piece' || thousandths === 0) {
    return String(whole);
  }
  return `${whole}.${String(thousandths).padStart(MILLI_DECIMALS, '0').replace(/0+$/, '')}`;
}

/**
 * Makes the line of a product that was found. The quantity starts at what the reorder level suggests, or at one unit, and
 * the cost at the one of the supplier's list or of the product.
 *
 * @param candidate what the search answered
 * @param quantityMilli the quantity to start with, if the person or the suggestion already chose it
 * @returns the line
 */
export function lineFromCandidate(candidate: OrderCandidate, quantityMilli: number | null = null): DraftLine {
  const milli = quantityMilli ?? candidate.suggestedMilli ?? MILLI_PER_UNIT;
  return {
    key: newKey(),
    productId: candidate.productId,
    description: candidate.name,
    barcode: candidate.barcode,
    unit: candidate.unit,
    supplierCodes: candidate.supplierCodes,
    supplierCode: candidate.supplierCodes[0]?.supplierCode ?? null,
    quantityText: quantityInputText(Math.min(milli, MAX_ORDER_QUANTITY_MILLI), candidate.unit),
    costText: candidate.estimatedCostE6 === null ? '' : unitCostText(candidate.estimatedCostE6),
    stockMilli: candidate.stockMilli,
    minimumMilli: candidate.minimumMilli,
    maximumMilli: candidate.maximumMilli,
    suggestedMilli: candidate.suggestedMilli,
  };
}

/**
 * Makes the line of an order that was saved.
 *
 * @param line the saved line
 * @returns the line, ready to edit
 */
export function lineFromSaved(line: OrderLine): DraftLine {
  return {
    key: newKey(),
    productId: line.productId,
    description: line.description,
    barcode: line.barcode,
    unit: line.unit,
    supplierCodes: line.supplierCode === null ? [] : [{ supplierCode: line.supplierCode, listCostE6: null, purchaseUnit: null }],
    supplierCode: line.supplierCode,
    quantityText: quantityInputText(line.quantityMilli, line.unit),
    costText: line.unitCostE6 === null ? '' : unitCostText(line.unitCostE6),
    stockMilli: null,
    minimumMilli: null,
    maximumMilli: null,
    suggestedMilli: null,
  };
}

/** What reading one line gave: the line to save and its amount, or what to tell the person. */
export type LineReading =
  | { readonly ok: true; readonly request: OrderLineRequest; readonly totalCents: number | null }
  | { readonly ok: false; readonly quantityProblem?: string; readonly costProblem?: string };

/**
 * Reads what was typed in a line. The quantity needs up to 3 decimals (whole for pieces) and must be above zero, and the cost
 * may be left empty until it is known. No decimal number is ever used: the amount comes from whole numbers.
 *
 * @param line the line as edited
 * @returns the request to save, with the amount in cents, or the problems to show under the boxes
 */
export function readLine(line: DraftLine): LineReading {
  let quantityMilli = 0;
  let quantityProblem: string | undefined;
  try {
    quantityMilli = parseQuantity(line.quantityText.trim(), line.unit).milli;
    if (quantityMilli === 0) {
      quantityProblem = 'Debe ser mayor que cero.';
    } else if (quantityMilli > MAX_ORDER_QUANTITY_MILLI) {
      quantityProblem = 'Es demasiado: el máximo es 100,000 por renglón.';
    }
  } catch (error) {
    quantityProblem =
      error instanceof MoneyError && error.code === 'fractional_piece'
        ? 'Las piezas van enteras.'
        : 'Escribe solo números, con hasta 3 decimales.';
  }
  let unitCostE6: number | null = null;
  let costProblem: string | undefined;
  if (line.costText.trim() !== '') {
    const cost = readUnitCost(line.costText);
    if (cost.ok) {
      unitCostE6 = cost.unitCostE6;
    } else {
      costProblem = cost.message;
    }
  }
  if (quantityProblem !== undefined || costProblem !== undefined) {
    return { ok: false, ...(quantityProblem === undefined ? {} : { quantityProblem }), ...(costProblem === undefined ? {} : { costProblem }) };
  }
  return {
    ok: true,
    request: { productId: line.productId, supplierCode: line.supplierCode, quantityMilli, unitCostE6 },
    totalCents: unitCostE6 === null ? null : orderLineCents(unitCostE6, quantityMilli),
  };
}

/** The estimate of a whole order. */
export interface OrderTotals {
  /** The sum of the lines that have a cost, in cents. */
  readonly totalCents: number;
  /** How many lines have no cost yet and are left out of the total. */
  readonly linesWithoutCost: number;
  /** Whether every line could be read. When false, the total is only of the lines that could. */
  readonly isComplete: boolean;
}

/**
 * Adds up the lines that can be read.
 *
 * @param lines the lines as edited
 * @returns the total and how many lines are left out
 */
export function totalsOf(lines: readonly DraftLine[]): OrderTotals {
  let totalCents = 0;
  let linesWithoutCost = 0;
  let isComplete = true;
  for (const line of lines) {
    const reading = readLine(line);
    if (!reading.ok) {
      isComplete = false;
    } else if (reading.totalCents === null) {
      linesWithoutCost += 1;
    } else {
      totalCents += reading.totalCents;
    }
  }
  return { totalCents, linesWithoutCost, isComplete };
}

/**
 * Tells what a refusal of the owner's approval means for the person at the screen.
 *
 * @param refusal the answer that was not a success
 * @returns the message in Spanish
 */
export function describeRefusal(refusal: OwnerRefusalResult): string {
  switch (refusal.status) {
    case 'authorization_required':
      return 'Pídele al dueño que escriba su PIN.';
    case 'wrong_pin':
      return `PIN del dueño incorrecto. Quedan ${refusal.attemptsLeft} intentos. Quedó anotado en la bitácora.`;
    case 'locked':
      return 'Demasiados intentos con el PIN del dueño. Espera unos minutos. Quedó anotado en la bitácora.';
  }
}

/**
 * Tells whether an answer is a refusal of the owner's approval.
 *
 * @param result any answer of the purchase order bridge
 * @returns true if it is `authorization_required`, `wrong_pin` or `locked`
 */
export function isOwnerRefusal(result: { readonly status: string }): result is OwnerRefusalResult {
  return result.status === 'authorization_required' || result.status === 'wrong_pin' || result.status === 'locked';
}
