import type { TaxRate } from '@pos-saas/money';

import type { CatalogProduct } from './pos-api';

/**
 * The highest unit price the register accepts, in ten-thousandths of a peso: $1,000,000.00. It is far above any product
 * of a hardware store, so an extra zero typed by mistake is caught instead of being charged (ADR 0047).
 */
export const MAX_UNIT_PRICE_E4 = 10_000_000_000;

/** A product with what the screen needs to change its price. */
export interface PriceInfo {
  readonly product: CatalogProduct;
  /** The last known cost per unit in millionths of a peso, or null if the product never had one. */
  readonly lastCostE6: number | null;
}

/** What the person at the register asks for: a new price, with VAT included, for one product. */
export interface ChangePriceRequest {
  /** UUIDv7 of the product. */
  readonly productId: string;
  /** The price the screen showed, in ten-thousandths of a peso. If it is no longer the price, nothing changes. */
  readonly previousUnitPriceE4: number;
  /** The new price with VAT included, in ten-thousandths of a peso. It is a whole number above zero. */
  readonly newUnitPriceE4: number;
  /** The PIN of an owner, when a cashier asks. The owner who is signed in needs none. */
  readonly ownerPin?: string;
}

/** How a price change ended. */
export type ChangePriceResult =
  | { readonly status: 'changed'; readonly product: CatalogProduct; readonly previousUnitPriceE4: number }
  /** The new price is the one the product already has. Nothing was written. */
  | { readonly status: 'unchanged' }
  | { readonly status: 'not_found' }
  /** The price is no longer the one the screen showed. Nothing was written. */
  | { readonly status: 'stale'; readonly product: CatalogProduct }
  /** A cashier asked without the PIN of an owner. */
  | { readonly status: 'authorization_required' }
  | { readonly status: 'wrong_pin'; readonly attemptsLeft: number }
  | { readonly status: 'locked'; readonly until: string };

/** What the screen can ask of the main process about prices. It is its own interface so the sale screen does not depend on it. */
export interface PricingApi {
  /**
   * Reads the price of a product and its last known cost, to show the margin before and after a change.
   *
   * @param productId the UUIDv7 of the product
   * @returns the information, or null if the product does not exist
   */
  getPriceInfo(productId: string): Promise<PriceInfo | null>;

  /**
   * Changes the price of a product in the catalog (E1-39). Only the owner, or a cashier with the PIN of an owner. The sales
   * already completed and the lines already saved keep the price they were sold at. The change is written down in the audit
   * log and queued for the core in the same transaction.
   *
   * @param request the product, the price the screen saw, the new price, and the PIN when a cashier asks
   * @returns `changed`, or why nothing changed
   */
  changePrice(request: ChangePriceRequest): Promise<ChangePriceResult>;
}

const BP_PER_UNIT = 10_000n;
const E4_TO_E6 = 100n;

/**
 * Works out the margin of a price: what is left of the price before VAT after taking out the cost, as a share of that
 * price. All the arithmetic is on integers, and the result is in basis points: 3,333 is 33.33%.
 *
 * @param unitPriceE4 the price with VAT included, in ten-thousandths of a peso
 * @param taxRate the VAT included in the price
 * @param unitCostE6 the cost per unit in millionths of a peso
 * @returns the margin in basis points (negative if the product sells below its cost), or null if the price has nothing left after VAT
 */
export function marginBasisPoints(unitPriceE4: number, taxRate: TaxRate, unitCostE6: number): number | null {
  const rateBp = taxRate.factor === 'rate' ? BigInt(taxRate.rateBp) : 0n;
  const baseE6 = (BigInt(unitPriceE4) * E4_TO_E6 * BP_PER_UNIT) / (BP_PER_UNIT + rateBp);
  if (baseE6 <= 0n) {
    return null;
  }
  const difference = baseE6 - BigInt(unitCostE6);
  const magnitude = difference < 0n ? -difference : difference;
  const rounded = (magnitude * BP_PER_UNIT * 2n + baseE6) / (baseE6 * 2n);
  return Number(difference < 0n ? -rounded : rounded);
}
