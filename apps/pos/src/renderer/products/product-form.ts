import { MoneyError, parseQuantity, type TaxRate, type Unit } from '@pos-saas/money';

import {
  isValidTaxRate,
  OFFERED_TAX_RATES,
  problemWithBarcodes,
  problemWithName,
  readUnitCost,
  unitCostText,
  type NewProductRequest,
  type ProductDetail,
  type UpdateProductRequest,
} from '../../shared/product-admin';
import { readNewPrice } from '../pricing/price-input';

/** What the boxes of the product form hold while the person types: text, until it is read. */
export interface ProductFormValues {
  readonly name: string;
  readonly unit: Unit;
  /** The price in pesos with VAT included, as typed. */
  readonly price: string;
  /** The VAT rate, as `taxKeyOf` writes it. */
  readonly taxKey: string;
  /** The cost per unit in pesos, as typed. Empty when the owner does not know it. */
  readonly cost: string;
  readonly barcodes: readonly string[];
  /** The stock the shelf has now, in the unit of the product, as typed. Empty to start with nothing. */
  readonly stock: string;
  readonly isActive: boolean;
}

/** What is wrong, box by box, in the words of the shop. */
export interface ProductFormProblems {
  readonly name?: string;
  readonly price?: string;
  readonly cost?: string;
  readonly stock?: string;
  readonly barcodes?: string;
}

/** A form of a new product. A piece is the unit most of the hardware store is counted in, and VAT is 16%. */
export const EMPTY_PRODUCT_FORM: ProductFormValues = {
  name: '',
  unit: 'piece',
  price: '',
  taxKey: 'rate:1600',
  cost: '',
  barcodes: [],
  stock: '',
  isActive: true,
};

/**
 * Names a VAT rate for a list of choices and for keeping it in a form.
 *
 * @param taxRate the rate
 * @returns `rate:1600` or `exempt:0`
 */
export function taxKeyOf(taxRate: TaxRate): string {
  return `${taxRate.factor}:${taxRate.rateBp}`;
}

/**
 * Turns the key of a choice back into the VAT rate.
 *
 * @param key what `taxKeyOf` wrote
 * @returns the rate
 * @throws RangeError if the key is not one that `taxKeyOf` writes
 */
export function taxRateOfKey(key: string): TaxRate {
  const [factor, rateBp] = key.split(':');
  const taxRate = { factor, rateBp: Number(rateBp) } as TaxRate;
  if (!isValidTaxRate(taxRate)) {
    throw new RangeError(`Not a VAT rate: ${key}`);
  }
  return taxRate;
}

/**
 * Lists the VAT rates the form offers, and also the rate the product already has when it is not one of them.
 *
 * @param current the rate of the product being edited, if any
 * @returns the rates, in the order they are shown
 */
export function offeredTaxRates(current?: TaxRate): readonly TaxRate[] {
  const offered = OFFERED_TAX_RATES;
  return current === undefined || offered.some((rate) => taxKeyOf(rate) === taxKeyOf(current)) ? offered : [...offered, current];
}

/**
 * Guesses whether what a person typed in the lookup box, or a scanner sent, was a barcode and not a name: one word with a
 * digit in it, long enough that it is not a size such as "1/2".
 *
 * @param text what was typed or scanned
 * @param fromScanner whether it came in as a burst of keys, which is always a code
 * @returns true if it should fill the barcode box of a new product, and false if it should fill the name
 */
export function looksLikeBarcode(text: string, fromScanner: boolean): boolean {
  const trimmed = text.trim();
  if (problemWithBarcodes([trimmed]) !== null) {
    return false;
  }
  return fromScanner || (trimmed.length >= 6 && /\d/u.test(trimmed));
}

/**
 * The form of a new product, with what the person already typed or scanned in the sale loaded.
 *
 * @param text what was typed or scanned, or an empty text
 * @param fromScanner whether it came from the scanner
 * @returns the values to start from
 */
export function newProductFormFor(text: string, fromScanner: boolean): ProductFormValues {
  const trimmed = text.trim();
  if (trimmed === '') {
    return EMPTY_PRODUCT_FORM;
  }
  return looksLikeBarcode(trimmed, fromScanner) ? { ...EMPTY_PRODUCT_FORM, barcodes: [trimmed] } : { ...EMPTY_PRODUCT_FORM, name: trimmed };
}

/** What reading the form of a new product gave: the request to send, or what to fix. */
export type NewProductReading =
  | { readonly ok: true; readonly request: Omit<NewProductRequest, 'ownerPin'> }
  | { readonly ok: false; readonly problems: ProductFormProblems };

/**
 * Reads the stock typed by a person in the unit of the product, with the Quantity rules of the money package: up to three
 * decimals, and whole pieces.
 *
 * @param text what was typed
 * @param unit the unit of the product
 * @returns the stock in thousandths, or what to tell the person
 */
export function readStock(text: string, unit: Unit): { readonly ok: true; readonly milli: number } | { readonly ok: false; readonly message: string } {
  try {
    const { milli } = parseQuantity(text.trim(), unit);
    return milli === 0 ? { ok: false, message: 'La existencia debe ser mayor que cero. Déjala vacía si no hay nada todavía.' } : { ok: true, milli };
  } catch (error) {
    if (error instanceof MoneyError && error.code === 'fractional_piece') {
      return { ok: false, message: 'Las piezas se cuentan enteras. Para medir con decimales elige metro, kilo o litro.' };
    }
    return {
      ok: false,
      message: error instanceof MoneyError ? 'La existencia no es válida: usa números, con hasta 3 decimales.' : 'No se pudo leer la existencia.',
    };
  }
}

/**
 * Reads the form of a new product, with the same rules the main process checks again.
 *
 * @param values what the boxes hold
 * @returns the request without the PIN, or every problem found, so the person can fix them in one go
 */
export function readNewProductForm(values: ProductFormValues): NewProductReading {
  const problems: { -readonly [Key in keyof ProductFormProblems]: ProductFormProblems[Key] } = {};
  const nameProblem = problemWithName(values.name);
  if (nameProblem !== null) {
    problems.name = nameProblem;
  }
  const price = readNewPrice(values.price);
  if (!price.ok) {
    problems.price = price.message;
  }
  let unitCostE6: number | null = null;
  if (values.cost.trim() !== '') {
    const cost = readUnitCost(values.cost);
    if (cost.ok) {
      unitCostE6 = cost.unitCostE6;
    } else {
      problems.cost = cost.message;
    }
  }
  let initialStockMilli: number | null = null;
  if (values.stock.trim() !== '') {
    const stock = readStock(values.stock, values.unit);
    if (stock.ok) {
      initialStockMilli = stock.milli;
    } else {
      problems.stock = stock.message;
    }
  }
  const barcodesProblem = problemWithBarcodes(values.barcodes);
  if (barcodesProblem !== null) {
    problems.barcodes = barcodesProblem;
  }
  if (!price.ok || Object.keys(problems).length > 0) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    request: {
      name: values.name.trim(),
      unit: values.unit,
      unitPriceE4: price.unitPriceE4,
      taxRate: taxRateOfKey(values.taxKey),
      unitCostE6,
      barcodes: values.barcodes.map((code) => code.trim()),
      initialStockMilli,
      isActive: values.isActive,
    },
  };
}

/**
 * Fills the boxes of the panel with a product as it is now. The price and the stock have no box in the panel, so they stay
 * empty: they change with their own dialogs.
 *
 * @param product the product loaded from the main process
 * @returns the values the boxes start with, which are also what the panel compares against to tell if anything changed
 */
export function formValuesOf(product: ProductDetail): ProductFormValues {
  return {
    name: product.name,
    unit: product.unit,
    price: '',
    taxKey: taxKeyOf(product.taxRate),
    cost: product.unitCostE6 === null ? '' : unitCostText(product.unitCostE6),
    barcodes: product.barcodes,
    stock: '',
    isActive: product.isActive,
  };
}

/** What reading the form of the panel gave: what to send, or what to fix. */
export type ProductEditReading =
  | { readonly ok: true; readonly changes: Omit<UpdateProductRequest, 'productId' | 'expectedRevision' | 'ownerPin'> }
  | { readonly ok: false; readonly problems: ProductFormProblems };

/**
 * Reads the boxes of the panel, with the same rules the main process checks again. The price and the stock are not read:
 * the panel does not write them.
 *
 * @param values what the boxes hold
 * @returns the new state of the edited fields, or every problem found
 */
export function readEditForm(values: ProductFormValues): ProductEditReading {
  const problems: { -readonly [Key in keyof ProductFormProblems]: ProductFormProblems[Key] } = {};
  const nameProblem = problemWithName(values.name);
  if (nameProblem !== null) {
    problems.name = nameProblem;
  }
  let unitCostE6: number | null = null;
  if (values.cost.trim() !== '') {
    const cost = readUnitCost(values.cost);
    if (cost.ok) {
      unitCostE6 = cost.unitCostE6;
    } else {
      problems.cost = cost.message;
    }
  }
  const barcodesProblem = problemWithBarcodes(values.barcodes);
  if (barcodesProblem !== null) {
    problems.barcodes = barcodesProblem;
  }
  if (Object.keys(problems).length > 0) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    changes: {
      name: values.name.trim(),
      unit: values.unit,
      taxRate: taxRateOfKey(values.taxKey),
      unitCostE6,
      isActive: values.isActive,
      barcodes: values.barcodes.map((code) => code.trim()),
    },
  };
}
