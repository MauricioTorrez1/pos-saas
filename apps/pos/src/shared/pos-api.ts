import type { Quantity, TaxRate, Unit } from '@pos-saas/money';

import type { Appearance } from './appearance';

/** Channels between the preload bridge and the main process. */
export const IPC_CHANNELS = {
  getAppInfo: 'app:get-info',
  findProductByCode: 'catalog:find-by-code',
  searchProducts: 'catalog:search',
  getAppearance: 'appearance:get',
  saveAppearance: 'appearance:save',
  savePendingSale: 'sales:save-pending',
  listPendingSales: 'sales:list-pending',
  confirmPendingSale: 'sales:confirm-pending',
  cancelPendingSale: 'sales:cancel-pending',
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

/** A sale the screen wants saved before anything is charged. The prices come from the catalog, not from the screen. */
export interface PendingSaleRequest {
  /** A UUID the screen creates once per sale. Sending it again returns the same sale instead of a second one. */
  readonly idempotencyKey: string;
  readonly lines: readonly {
    readonly productId: string;
    /** Thousandths of the base unit of the product: 3.275 m is 3275. */
    readonly quantityMilli: number;
  }[];
  /** The total the customer sees, in cents. If the catalog gives another total, the sale is not saved. */
  readonly expectedTotalCents: number;
}

/** One product of a sale waiting to be resolved. */
export interface PendingSaleLine {
  readonly productName: string;
  readonly quantity: Quantity;
  /** Price per unit with VAT, in ten-thousandths of a peso. */
  readonly unitPriceE4: number;
  /** What the customer pays for the line, in cents. */
  readonly totalCents: number;
}

/** A sale saved before being charged, which nobody has confirmed or cancelled yet (ADR 0010). */
export interface PendingSale {
  /** UUIDv7 of the sale. */
  readonly id: string;
  /** When it was saved, in ISO 8601. */
  readonly occurredAt: string;
  readonly lines: readonly PendingSaleLine[];
  /** What the customer pays, in cents. */
  readonly totalCents: number;
}

/** How saving a pending sale ended. */
export type SavePendingSaleResult =
  | { readonly status: 'saved'; readonly sale: PendingSale }
  /** A product no longer exists or its price changed, so the screen shows a sale that does not match. Nothing was saved. */
  | { readonly status: 'catalog_changed' };

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

  /**
   * Saves a sale as `pending_payment`, before anything is charged (ADR 0010).
   *
   * @param request the products, the quantities, and the total the customer sees
   * @returns the saved sale, or `catalog_changed` if the sale on the screen no longer matches the catalog
   */
  savePendingSale(request: PendingSaleRequest): Promise<SavePendingSaleResult>;

  /**
   * Reads the sales that were left without being confirmed or cancelled, as after a power cut (RF-017).
   *
   * @returns the sales, oldest first
   */
  listPendingSales(): Promise<readonly PendingSale[]>;

  /**
   * Confirms that a pending sale was paid. It records a cash payment for the whole total, which is the only method the
   * register can take until E1-11.
   *
   * @param saleId the sale
   * @returns once it is safely on disk
   */
  confirmPendingSale(saleId: string): Promise<void>;

  /**
   * Cancels a pending sale that was not paid. The sale is kept, marked as cancelled.
   *
   * @param saleId the sale
   * @returns once it is safely on disk
   */
  cancelPendingSale(saleId: string): Promise<void>;
}
