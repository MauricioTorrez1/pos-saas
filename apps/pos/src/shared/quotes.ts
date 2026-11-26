import type { Quantity, TaxRate } from '@pos-saas/money';

import type { CatalogProduct } from './pos-api';

/**
 * Quotes (F2-07, ADR 0077): a priced list the customer takes home before buying. A quote never moves stock and never
 * counts as a sale; when the customer comes back, it is turned into a normal sale at the register.
 */

/** How many days a new quote holds its prices, unless the person picks another day. */
export const QUOTE_VALIDITY_DAYS = 15;
/** The furthest a quote may be valid, so a typo in the year cannot freeze a price for a decade. */
export const MAX_QUOTE_VALIDITY_DAYS = 365;
export const MAX_QUOTE_LINES = 200;
export const MAX_QUOTE_CUSTOMER_NAME = 80;
export const MAX_QUOTE_CUSTOMER_PHONE = 20;
export const MAX_QUOTE_NOTES = 300;
export const MAX_QUOTE_CANCEL_REASON = 120;
/** The most quotes the list shows; the search narrows them. */
export const MAX_QUOTES_LISTED = 200;

/** What a quote says it is: still open, sold, or cancelled. The history only ever adds one of these. */
export const QUOTE_STATUSES = ['draft', 'converted', 'cancelled'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** What the screen shows: an open quote past its day is expired, which is worked out, never written. */
export type QuoteDisplayStatus = QuoteStatus | 'expired';

export const QUOTE_STATUS_FILTERS = ['all', 'draft', 'expired', 'converted', 'cancelled'] as const;
export type QuoteStatusFilter = (typeof QUOTE_STATUS_FILTERS)[number];

export const QUOTE_STATUS_LABELS: Readonly<Record<QuoteDisplayStatus, string>> = {
  draft: 'Vigente',
  expired: 'Vencida',
  converted: 'Vendida',
  cancelled: 'Cancelada',
};

export const QUOTE_FILTER_LABELS: Readonly<Record<QuoteStatusFilter, string>> = {
  all: 'Todas',
  draft: 'Vigentes',
  expired: 'Vencidas',
  converted: 'Vendidas',
  cancelled: 'Canceladas',
};

/** A product the person wants quoted: which one and how much. The price comes from the catalog, never from the screen. */
export interface QuoteLineInput {
  readonly productId: string;
  /** Thousandths of the base unit of the product: 3.275 m is 3275. */
  readonly quantityMilli: number;
}

/** A quote to create (no `quoteId`) or a draft to replace. */
export interface SaveQuoteRequest {
  /** The quote being edited, or null for a new one. */
  readonly quoteId: string | null;
  /** A UUID the screen creates once per new quote. Sending it again returns the same quote instead of a second one. */
  readonly idempotencyKey: string;
  readonly customerName: string | null;
  readonly customerPhone: string | null;
  readonly notes: string | null;
  /** The last day the prices hold, as `YYYY-MM-DD` in the time of the register. */
  readonly validUntil: string;
  readonly lines: readonly QuoteLineInput[];
  /** The quote this one was copied from, so its history says so. */
  readonly duplicatedFrom?: string | null;
}

/** One product of a quote, with the price it was quoted at. */
export interface QuoteLine {
  readonly productId: string;
  readonly productName: string;
  readonly quantity: Quantity;
  /** The price per unit with VAT at the time of the quote, in ten-thousandths of a peso. */
  readonly unitPriceE4: number;
  readonly taxRate: TaxRate;
  /** What the line costs at the quoted price, in cents. */
  readonly totalCents: number;
  /** The price of the catalog today, or null when the product is no longer sold. */
  readonly currentPriceE4: number | null;
}

/** One step of the history of a quote. Steps are only added, never changed. */
export interface QuoteEvent {
  readonly status: QuoteStatus;
  readonly at: string;
  readonly byName: string;
  /** Why it was cancelled, which quote it was copied from, or the folio of the sale it became. */
  readonly note: string | null;
}

/** A quote, whole. */
export interface Quote {
  readonly id: string;
  readonly folio: string;
  readonly customerName: string | null;
  readonly customerPhone: string | null;
  readonly notes: string | null;
  readonly validUntil: string;
  readonly createdAt: string;
  readonly createdById: string;
  readonly createdByName: string;
  readonly updatedAt: string;
  readonly status: QuoteDisplayStatus;
  readonly lines: readonly QuoteLine[];
  readonly subtotalCents: number;
  readonly taxCents: number;
  readonly totalCents: number;
  /** The sale it became, once it was sold. */
  readonly saleId: string | null;
  readonly history: readonly QuoteEvent[];
  /** How many times it was printed. */
  readonly timesPrinted: number;
}

/** A quote as the list shows it. */
export interface QuoteSummary {
  readonly id: string;
  readonly folio: string;
  readonly customerName: string | null;
  readonly customerPhone: string | null;
  readonly createdAt: string;
  readonly validUntil: string;
  readonly status: QuoteDisplayStatus;
  readonly lineCount: number;
  readonly totalCents: number;
}

export interface QuoteSearch {
  /** A folio (`COT-000012` or `12`), a name, a phone or a product. Empty lists them all. */
  readonly text: string;
  readonly status: QuoteStatusFilter;
}

export type SaveQuoteResult =
  | { readonly status: 'saved'; readonly quote: Quote }
  | { readonly status: 'invalid'; readonly message: string }
  /** It was sold or cancelled meanwhile, and only an open quote is edited. */
  | { readonly status: 'not_editable' };

export interface CancelQuoteRequest {
  readonly quoteId: string;
  readonly reason: string;
  /** The PIN of an owner, when a cashier cancels a quote somebody else made. */
  readonly ownerPin?: string;
}

export type CancelQuoteResult =
  | { readonly status: 'cancelled'; readonly quote: Quote }
  | { readonly status: 'invalid'; readonly message: string }
  | { readonly status: 'not_cancellable' }
  | { readonly status: 'owner_pin_required' }
  | { readonly status: 'wrong_pin'; readonly attemptsLeft: number }
  | { readonly status: 'locked' };

/** One product ready to go onto the sale. */
export interface ConversionLine {
  /** The product as the catalog has it today. */
  readonly product: CatalogProduct;
  readonly quantityMilli: number;
  /** The price the line is charged at: the quoted one while the quote is valid, today's once it expired. */
  readonly chargedPriceE4: number;
  readonly quotedPriceE4: number;
}

export type PrepareConversionResult =
  | {
      readonly status: 'ready';
      readonly quoteId: string;
      readonly folio: string;
      /** True when the quote expired, so every line goes at today's price. */
      readonly isExpired: boolean;
      readonly lines: readonly ConversionLine[];
      /** The products that are no longer sold, which stay out of the sale. */
      readonly skipped: readonly string[];
    }
  | { readonly status: 'not_convertible'; readonly message: string };

export interface MarkConvertedRequest {
  readonly quoteId: string;
  readonly saleId: string;
}

export type MarkConvertedResult = { readonly status: 'converted' } | { readonly status: 'not_convertible'; readonly message: string };

export type PrintQuoteResult =
  | { readonly status: 'printed' }
  | { readonly status: 'no_printer' }
  | { readonly status: 'failed'; readonly message: string };

export const QUOTE_CHANNELS = {
  list: 'quotes:list',
  get: 'quotes:get',
  save: 'quotes:save',
  cancel: 'quotes:cancel',
  preview: 'quotes:preview',
  print: 'quotes:print',
  prepareConversion: 'quotes:prepare-conversion',
  markConverted: 'quotes:mark-converted',
} as const;

/** The bridge of the quotes. Anyone signed in can use it; cancelling somebody else's quote needs the owner. */
export interface QuotesApi {
  list(search: QuoteSearch): Promise<QuoteSummary[]>;
  get(quoteId: string): Promise<Quote | null>;
  save(request: SaveQuoteRequest): Promise<SaveQuoteResult>;
  cancel(request: CancelQuoteRequest): Promise<CancelQuoteResult>;
  /** @returns the lines of the printed quote, as the ticket printer would print them */
  preview(quoteId: string): Promise<string[]>;
  print(quoteId: string): Promise<PrintQuoteResult>;
  /** Reads a quote as the lines of a sale, with the prices it is charged at. Nothing is saved. */
  prepareConversion(quoteId: string): Promise<PrepareConversionResult>;
  /** Marks a quote as sold, once its sale was collected. */
  markConverted(request: MarkConvertedRequest): Promise<MarkConvertedResult>;
}

const FOLIO_PREFIX = 'COT-';
const FOLIO_DIGITS = 6;

/**
 * Writes the folio of a quote, which the customer reads out when coming back.
 *
 * @param folioNumber the number of the quote, starting at 1
 * @returns text such as `COT-000012`
 */
export function formatQuoteFolio(folioNumber: number): string {
  return `${FOLIO_PREFIX}${String(folioNumber).padStart(FOLIO_DIGITS, '0')}`;
}

/**
 * Reads a folio typed by the person.
 *
 * @param text `COT-000012`, `cot 12` or `12`
 * @returns the number, or null when the text is not a folio
 */
export function parseQuoteFolio(text: string): number | null {
  const match = /^(?:cot)?[-\s]*0*(\d{1,9})$/iu.exec(text.trim());
  return match === null ? null : Number(match[1]);
}

/**
 * Moves a local day by some days.
 *
 * @param day `YYYY-MM-DD`
 * @param days how many days later, or earlier when negative
 * @returns the day, as `YYYY-MM-DD`
 */
export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return localDay(new Date(year, month - 1, date + days));
}

/**
 * The day of a moment in the time of the register.
 *
 * @param moment any moment
 * @returns `YYYY-MM-DD`
 */
export function localDay(moment: Date): string {
  return `${String(moment.getFullYear())}-${String(moment.getMonth() + 1).padStart(2, '0')}-${String(moment.getDate()).padStart(2, '0')}`;
}

/**
 * Tells whether an open quote is past its day. A quote is valid through the whole of its last day.
 *
 * @param validUntil the last day, `YYYY-MM-DD`
 * @param today the day of the register, `YYYY-MM-DD`
 * @returns true when the prices no longer hold
 */
export function isQuoteExpired(validUntil: string, today: string): boolean {
  return today > validUntil;
}

/**
 * Shows a day as people read it.
 *
 * @param day `YYYY-MM-DD`
 * @returns text such as `10 dic 2026`
 */
export function quoteDayLabel(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' }).format(new Date(year, month - 1, date));
}
