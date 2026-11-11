import type { TaxRate, Unit } from '@pos-saas/money';

import type { KardexRow } from './inventory-api';

/** The longest name of a product. It is the limit of the contract with the core. */
export const MAX_PRODUCT_NAME_LENGTH = 200;
/** The longest barcode, in characters. It is the limit of the contract with the core. */
export const MAX_BARCODE_LENGTH = 64;
/** The most barcodes one product can have. It is the limit of the contract with the core. */
export const MAX_BARCODES_PER_PRODUCT = 20;
/** The highest cost per unit the register accepts, in millionths of a peso: $1,000,000.00 (the same ceiling as the price). */
export const MAX_UNIT_COST_E6 = 1_000_000_000_000;

/** The VAT rates the product form offers. Any other rate a product already has is shown as it is. */
export const OFFERED_TAX_RATES: readonly TaxRate[] = [
  { factor: 'rate', rateBp: 1600 },
  { factor: 'rate', rateBp: 800 },
  { factor: 'rate', rateBp: 0 },
  { factor: 'exempt', rateBp: 0 },
];

/** A product as the product screens need it, with what is not in the sale catalog: cost, state, barcodes and stock. */
export interface ProductDetail {
  /** UUIDv7 of the product. */
  readonly id: string;
  readonly name: string;
  readonly unit: Unit;
  /** Price per unit with VAT, in ten-thousandths of a peso. */
  readonly unitPriceE4: number;
  readonly taxRate: TaxRate;
  /** The cost per unit the owner typed, in millionths of a peso, or null if there is none. */
  readonly unitCostE6: number | null;
  /** The cost the margin is worked out with: the one the owner typed, or else the last one of the ledger. Null if unknown. */
  readonly effectiveCostE6: number | null;
  /** False once the product was given up: it is not sold or found by the sale screen, but it stays for the history. */
  readonly isActive: boolean;
  /** Goes up by one with every change, so a screen can tell that the product changed while it was being edited. */
  readonly revision: number;
  /** Every barcode of the product, sorted. */
  readonly barcodes: readonly string[];
  /** The sum of the movements of the ledger, in thousandths of the unit. It is never edited, only calculated. */
  readonly stockMilli: number;
  /** How many movements the product has in the ledger. While it has any, its unit cannot change. */
  readonly movementCount: number;
}

/** What the person at the register asks for to add a product that is not in the catalog (E1-42). */
export interface NewProductRequest {
  readonly name: string;
  /** The unit of measure the quantities of the product are counted in. */
  readonly unit: Unit;
  /** Price per unit with VAT included, in ten-thousandths of a peso. It is above zero. */
  readonly unitPriceE4: number;
  readonly taxRate: TaxRate;
  /** Cost per unit in millionths of a peso, or null if the owner does not know it yet. */
  readonly unitCostE6: number | null;
  /** Zero or more barcodes. A code another product already has is refused. */
  readonly barcodes: readonly string[];
  /** The stock the shelf has now, in thousandths of the unit, or null to start with nothing. It is posted as a movement. */
  readonly initialStockMilli: number | null;
  /** Whether the product can be sold right away. */
  readonly isActive: boolean;
  /** The PIN of an owner, when a cashier asks. The owner who is signed in needs none. */
  readonly ownerPin?: string;
}

/** How adding a product ended. */
export type CreateProductResult =
  | { readonly status: 'created'; readonly product: ProductDetail }
  /** Another product already has one of the codes. Nothing was written. */
  | { readonly status: 'duplicate_code'; readonly code: string; readonly productId: string; readonly productName: string }
  /** A cashier asked without the PIN of an owner. */
  | { readonly status: 'authorization_required' }
  | { readonly status: 'wrong_pin'; readonly attemptsLeft: number }
  | { readonly status: 'locked'; readonly until: string };

/** A product found by the product panel. Unlike the sale, the panel also finds the products that were given up. */
export interface ProductSummary {
  /** UUIDv7 of the product. */
  readonly id: string;
  readonly name: string;
  readonly unit: Unit;
  /** Price per unit with VAT, in ten-thousandths of a peso. */
  readonly unitPriceE4: number;
  readonly isActive: boolean;
}

/** A product with its latest movements, which is everything the product panel shows (E1-43). */
export interface ProductPanelDetail extends ProductDetail {
  /** The newest movements of the ledger first, at most 10, each with the balance it left. */
  readonly recentMovements: readonly KardexRow[];
}

/**
 * What the person at the panel wants the product to be: the new state of every field that is edited here. The price and the
 * stock are not here: the price changes with `PricingApi` and the stock only moves with adjustments.
 */
export interface UpdateProductRequest {
  readonly productId: string;
  /** The revision the screen loaded. If the product has another one, it changed while it was being edited and nothing is written. */
  readonly expectedRevision: number;
  readonly name: string;
  /** Can only differ from the current unit while the product has no movements in the ledger. */
  readonly unit: Unit;
  readonly taxRate: TaxRate;
  /** Cost per unit in millionths of a peso, or null for none. */
  readonly unitCostE6: number | null;
  /** False gives the product up (a logical delete: it is never removed). */
  readonly isActive: boolean;
  /** Every barcode the product should have afterwards. The ones that are not in it are removed, and the new ones are added. */
  readonly barcodes: readonly string[];
  /** The PIN of an owner, when a cashier asks. The owner who is signed in needs none. */
  readonly ownerPin?: string;
}

/** How saving the changes of a product ended. */
export type UpdateProductResult =
  | { readonly status: 'updated'; readonly product: ProductPanelDetail }
  /** The product already is what was asked. Nothing was written. */
  | { readonly status: 'unchanged'; readonly product: ProductPanelDetail }
  | { readonly status: 'not_found' }
  /** The product changed after the screen loaded it. Nothing was written, and this is how it is now. */
  | { readonly status: 'stale'; readonly product: ProductPanelDetail }
  /** Another product already has one of the codes that were added. Nothing was written. */
  | { readonly status: 'duplicate_code'; readonly code: string; readonly productId: string; readonly productName: string }
  /** The product already has movements, so its unit cannot change. Nothing was written. */
  | { readonly status: 'unit_locked'; readonly movementCount: number }
  | { readonly status: 'authorization_required' }
  | { readonly status: 'wrong_pin'; readonly attemptsLeft: number }
  | { readonly status: 'locked'; readonly until: string };

/** What the screen can ask of the main process about the products of the catalog, besides selling them. */
export interface ProductAdminApi {
  /**
   * Adds a product that is not in the catalog, with its barcodes and its first stock, in one transaction (E1-42). Only the
   * owner, or a cashier with the PIN of an owner. The change is written down in the audit log and queued for the core.
   *
   * @param request what the form collected
   * @returns the product that was created, or why nothing was written
   */
  createProduct(request: NewProductRequest): Promise<CreateProductResult>;

  /**
   * Finds products by a barcode or by the beginning of the words of their names, including the ones that were given up (E1-43).
   *
   * @param text what was typed or scanned
   * @returns the best matches first, at most 20
   */
  findProducts(text: string): Promise<readonly ProductSummary[]>;

  /**
   * Reads a product whole, with its stock, its cost and its latest movements. Anyone signed in can look.
   *
   * @param productId the UUIDv7 of the product
   * @returns the product, or null if it does not exist
   */
  getProductDetail(productId: string): Promise<ProductPanelDetail | null>;

  /**
   * Saves the changes of a product: name, barcodes, unit, VAT, cost and state (E1-43). Only the owner, or a cashier with the
   * PIN of an owner. Each change is written with its old and new value in the audit log and queued for the core in the same
   * transaction. It never deletes a product, and it never writes the price or the stock.
   *
   * @param request what the product should be, and the revision the screen saw
   * @returns the product as it is now, or why nothing was written
   */
  updateProduct(request: UpdateProductRequest): Promise<UpdateProductResult>;
}

/**
 * Checks the name of a product.
 *
 * @param name what was typed
 * @returns what to tell the person, or null if the name is fine
 */
export function problemWithName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === '') {
    return 'Escribe el nombre del producto.';
  }
  if ([...trimmed].length > MAX_PRODUCT_NAME_LENGTH) {
    return `El nombre admite hasta ${MAX_PRODUCT_NAME_LENGTH} letras.`;
  }
  return null;
}

/**
 * Checks one barcode. A scanner types the code and presses Enter, and a person may type it, so spaces around it are ignored.
 *
 * @param code what was scanned or typed
 * @returns what to tell the person, or null if the code is fine
 */
export function problemWithBarcode(code: string): string | null {
  const trimmed = code.trim();
  if (trimmed === '') {
    return 'El código está vacío.';
  }
  if ([...trimmed].length > MAX_BARCODE_LENGTH) {
    return `Un código admite hasta ${MAX_BARCODE_LENGTH} caracteres.`;
  }
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
  if (/[\u0000-\u001f\u007f\s]/u.test(trimmed)) {
    return 'El código no puede llevar espacios ni caracteres de control.';
  }
  return null;
}

/**
 * Checks a list of barcodes: each one valid, no repeats, and no more than a product may have.
 *
 * @param codes the codes of one product
 * @returns what to tell the person, or null if the list is fine
 */
export function problemWithBarcodes(codes: readonly string[]): string | null {
  if (codes.length > MAX_BARCODES_PER_PRODUCT) {
    return `Un producto admite hasta ${MAX_BARCODES_PER_PRODUCT} códigos.`;
  }
  const seen = new Set<string>();
  for (const code of codes) {
    const problem = problemWithBarcode(code);
    if (problem !== null) {
      return problem;
    }
    if (seen.has(code.trim())) {
      return `El código ${code.trim()} está repetido.`;
    }
    seen.add(code.trim());
  }
  return null;
}

/**
 * Checks a VAT rate: a rate between 0% and 100%, or exempt with a rate of zero.
 *
 * @param taxRate what the form chose
 * @returns whether the rate is one the register can charge
 */
export function isValidTaxRate(taxRate: TaxRate): boolean {
  if (taxRate.factor === 'exempt') {
    return taxRate.rateBp === 0;
  }
  return taxRate.factor === 'rate' && Number.isInteger(taxRate.rateBp) && taxRate.rateBp >= 0 && taxRate.rateBp <= 10_000;
}

/** What reading a cost typed by a person gave: the cost in millionths of a peso, or what to tell them. */
export type CostReading = { readonly ok: true; readonly unitCostE6: number } | { readonly ok: false; readonly message: string };

/**
 * Reads a cost per unit typed in pesos, as digits and one point with up to 6 decimals, without floating point (ADR 0011).
 * A cost of zero is allowed, because something received for free does cost nothing.
 *
 * @param text what was typed, such as "58.25"
 * @returns the cost in millionths of a peso, or a message in Spanish that says what to fix
 */
export function readUnitCost(text: string): CostReading {
  const match = /^([0-9]*)(?:\.([0-9]*))?$/.exec(text.trim());
  const whole = match?.[1] ?? '';
  const fraction = match?.[2] ?? '';
  if (match === null || whole.length + fraction.length === 0) {
    return { ok: false, message: 'Revisa el costo: solo números y un punto decimal, sin signo de pesos ni comas.' };
  }
  if (fraction.length > 6) {
    return { ok: false, message: 'El costo admite hasta 6 decimales.' };
  }
  const digits = `${whole}${fraction.padEnd(6, '0')}`.replace(/^0+(?=[0-9])/, '');
  if (digits.length > String(MAX_UNIT_COST_E6).length || Number(digits) > MAX_UNIT_COST_E6) {
    return { ok: false, message: 'El costo es demasiado alto: el máximo es $1,000,000.00. Revisa que no sobre un cero.' };
  }
  return { ok: true, unitCostE6: Number(digits) };
}

/**
 * Shows a cost as people read it: two decimals, and more only when the cost really has them.
 *
 * @param unitCostE6 the cost in millionths of a peso
 * @returns the cost with a peso sign, such as "$58.25"
 */
export function formatUnitCost(unitCostE6: number): string {
  const decimals = String(unitCostE6 % 1_000_000).padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  const wholePesos = Math.floor(unitCostE6 / 1_000_000);
  return `$${wholePesos.toLocaleString('en-US')}.${decimals}`;
}

/**
 * Writes a cost the way a person types it in a box: pesos with at least two decimals, no peso sign and no commas, so what
 * a box shows can be read back by `readUnitCost`.
 *
 * @param unitCostE6 the cost in millionths of a peso
 * @returns the text, such as "58.25" or "0.000001"
 */
export function unitCostText(unitCostE6: number): string {
  const decimals = String(unitCostE6 % 1_000_000).padStart(6, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${Math.floor(unitCostE6 / 1_000_000)}.${decimals}`;
}
