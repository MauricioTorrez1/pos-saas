import { lineAmountCents, MoneyError, parseQuantity, type Quantity } from '@pos-saas/money';

import type { CatalogProduct } from '../../shared/pos-api';

/**
 * The most a shop sells of one product in one line, in thousandths of its unit: 50 kg, 100 m, or 50 L. Typing 125 kg
 * when the customer asked for 1.25 kg is the mistake this guards against, so anything above asks for confirmation
 * (E1-08).
 */
export const TYPICAL_MAX_MILLI: Readonly<Record<Exclude<CatalogProduct['unit'], 'piece'>, number>> = {
  kilogram: 50_000,
  meter: 100_000,
  liter: 50_000,
};

/** What the cashier has typed so far for the quantity of a product. */
export type QuantityReading =
  | { readonly status: 'empty' }
  | { readonly status: 'invalid'; readonly message: string }
  | {
      readonly status: 'ok';
      readonly quantity: Quantity;
      /** What the line costs with this quantity, in cents, shown before it is added. */
      readonly amountCents: number;
      /** True when the quantity passes `TYPICAL_MAX_MILLI`, so the cashier must say it is right. */
      readonly needsConfirmation: boolean;
    };

/**
 * Tells whether the cashier must say how much of a product to add. Pieces add one at a time, and what is measured does
 * not.
 *
 * @param product the product
 * @returns true for a product sold by weight, length, or volume
 */
export function needsMeasuring(product: CatalogProduct): boolean {
  return product.unit !== 'piece';
}

/**
 * Reads the quantity typed for a measured product and works out the amount of the line.
 *
 * @param text what the cashier typed, such as "3.275"
 * @param product the product being measured
 * @returns `empty` while nothing is typed, `invalid` with a message the cashier can act on, or `ok` with the quantity, the
 * amount, and whether it needs confirmation
 */
export function readQuantity(text: string, product: CatalogProduct): QuantityReading {
  if (text.trim() === '') {
    return { status: 'empty' };
  }
  try {
    const quantity = parseQuantity(text.trim(), product.unit);
    if (quantity.milli === 0) {
      return { status: 'invalid', message: 'La cantidad debe ser mayor que cero.' };
    }
    return {
      status: 'ok',
      quantity,
      amountCents: lineAmountCents(product.unitPriceE4, quantity),
      needsConfirmation: quantity.milli > maxMilli(product),
    };
  } catch (error) {
    if (error instanceof MoneyError) {
      return { status: 'invalid', message: describeError(error) };
    }
    throw error;
  }
}

function maxMilli(product: CatalogProduct): number {
  return product.unit === 'piece' ? Number.MAX_SAFE_INTEGER : TYPICAL_MAX_MILLI[product.unit];
}

function describeError(error: MoneyError): string {
  switch (error.code) {
    case 'too_many_decimals':
      return 'La cantidad lleva máximo 3 decimales, por ejemplo 3.275.';
    case 'overflow':
      return 'El importe es demasiado grande para esta venta. Revisa la cantidad.';
    default:
      return 'Escribe la cantidad con números, por ejemplo 3 o 3.275.';
  }
}
