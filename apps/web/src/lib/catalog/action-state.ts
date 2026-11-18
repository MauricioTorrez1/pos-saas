import type { FieldErrors } from './product-form';
import type { ImportReport, PriceChangeRequest, PriceChangeResult } from './types';

/** What the product form shows after a submit. */
export interface ProductFormState {
  errors: FieldErrors;
  /** A message for the whole form, such as a core that does not answer. */
  message: string | null;
}

/** State of a form that was never submitted. */
export const EMPTY_PRODUCT_FORM: ProductFormState = { errors: {}, message: null };

/** What the price form of the edit page shows after a submit. */
export interface PriceFormState {
  error: string | null;
  /** The new price, as the core saved it, right after a change. */
  savedPrice: string | null;
}

/** State of the price form before any submit. */
export const EMPTY_PRICE_FORM: PriceFormState = { error: null, savedPrice: null };

/** What the import screen shows. */
export interface ImportState {
  report: ImportReport | null;
  error: string | null;
}

/** State of the import screen before a file is checked. */
export const EMPTY_IMPORT: ImportState = { report: null, error: null };

/** What the bulk price change screen shows. */
export interface PriceChangeState {
  /** The last preview and the request that produced it, so applying sends the same request. */
  preview: { request: PriceChangeRequest; result: PriceChangeResult } | null;
  /** How many prices changed, right after applying. */
  appliedCount: number | null;
  error: string | null;
  /** Set when the catalog moved since the preview: the screen shows a fresh preview and explains why. */
  staleNotice: string | null;
}

/** State of the bulk price change screen before a preview. */
export const EMPTY_PRICE_CHANGE: PriceChangeState = { preview: null, appliedCount: null, error: null, staleNotice: null };
