import type { TaxRate, Unit } from '@pos-saas/money';

import type { Appearance } from './appearance';

/** Channels between the preload bridge and the main process. */
export const IPC_CHANNELS = {
  getAppInfo: 'app:get-info',
  findProductByCode: 'catalog:find-by-code',
  searchProducts: 'catalog:search',
  getAppearance: 'appearance:get',
  saveAppearance: 'appearance:save',
} as const;

/** Longest text the screen can look up, which is more than any barcode or product name a person would enter. */
export const MAX_LOOKUP_TEXT_LENGTH = 100;

/** Facts about the running app that the screen may show. */
export interface AppInfo {
  readonly version: string;
}

/** A product as the sale screen needs it. Its amounts follow the scales of ADR 0011. */
export interface CatalogProduct {
  /** UUIDv7 of the product. */
  readonly id: string;
  readonly name: string;
  readonly unit: Unit;
  /** Price per unit with VAT, in ten-thousandths of a peso: $12.50 is 125000. */
  readonly unitPriceE4: number;
  readonly taxRate: TaxRate;
}

/** Everything the screen can ask of the main process. */
export interface PosApi {
  /**
   * Reads the facts about the running app.
   *
   * @returns the app version, as the main process knows it
   */
  getAppInfo(): Promise<AppInfo>;

  /**
   * Finds the product that has exactly this barcode.
   *
   * @param code the barcode, as scanned or typed
   * @returns the product, or null if no product has that code
   */
  findProductByCode(code: string): Promise<CatalogProduct | null>;

  /**
   * Finds products by the beginning of the words in their names. Accents and capitals do not matter.
   *
   * @param text what the cashier typed, such as "mart 16"
   * @returns the best matches first, at most 20
   */
  searchProducts(text: string): Promise<readonly CatalogProduct[]>;

  /**
   * Reads how the owner wants the register to look.
   *
   * @returns the saved appearance, or the default one if the owner never changed it
   */
  getAppearance(): Promise<Appearance>;

  /**
   * Saves how the owner wants the register to look.
   *
   * @param appearance the new appearance
   * @returns once it is safely on disk
   */
  saveAppearance(appearance: Appearance): Promise<void>;
}
