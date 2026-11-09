/** What an adjustment is: a count that corrected the shelf, or something lost that cannot be sold. */
export type AdjustmentType = 'adjustment' | 'waste';

/** One row of the kardex of a product. */
export interface KardexRow {
  /** When it happened, in ISO 8601. */
  readonly occurredAt: string;
  readonly type: 'opening_balance' | 'sale' | 'return' | 'adjustment' | 'waste';
  /** Signed, in thousandths of the unit of the product. */
  readonly quantityMilli: number;
  /** The stock after this movement. */
  readonly balanceMilli: number;
}

/** The history of a product and its stock, which always agree (RF-031). */
export interface Kardex {
  readonly productId: string;
  readonly productName: string;
  readonly unit: 'piece' | 'meter' | 'kilogram' | 'liter';
  /** The sum of every movement. */
  readonly stockMilli: number;
  /** The newest movements first, at most 50. */
  readonly rows: readonly KardexRow[];
  /** How many movements the product has in all. */
  readonly totalMovements: number;
}

/** What the owner says about a shelf that did not match, or about something lost (RF-030). */
export interface AdjustStockRequest {
  readonly productId: string;
  readonly type: AdjustmentType;
  /** Signed. A waste is always negative, and an adjustment may be either. */
  readonly quantityMilli: number;
  /** Why. It stays in the audit log. */
  readonly reason: string;
}

/** How an adjustment ended. */
export type AdjustStockResult =
  | { readonly status: 'recorded'; readonly kardex: Kardex }
  | { readonly status: 'not_found' }
  /** A waste has to take stock out. */
  | { readonly status: 'waste_must_be_negative' };

/** Something in the ledger that does not agree with the sales. */
export interface LedgerProblem {
  readonly kind: 'sale_without_movement' | 'return_without_movement' | 'movement_without_source' | 'wrong_quantity';
  /** The line of the sale or the return, or the movement, that does not agree. */
  readonly sourceId: string;
}

/** The result of comparing the ledger with the sales and the returns. */
export interface LedgerCheck {
  readonly checkedMovements: number;
  readonly problems: readonly LedgerProblem[];
}
