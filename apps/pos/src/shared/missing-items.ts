/**
 * The log of missing items: what customers ask for that the store does not carry (E1-49, ADR 0063). The cashier writes
 * it down in a few seconds, and the owner reads which things are asked for most, to decide what to start selling.
 */

export const MAX_MISSING_DESCRIPTION = 80;
export const MAX_MISSING_NOTES = 120;
export const MAX_MISSING_QUANTITY = 99_999;

/** The periods the log can be read for, in days. Zero means since the first entry. */
export const MISSING_PERIOD_CHOICES = [30, 90, 365, 0] as const;
export type MissingPeriod = (typeof MISSING_PERIOD_CHOICES)[number];

export const MISSING_PERIOD_LABELS: Readonly<Record<MissingPeriod, string>> = {
  30: 'Últimos 30 días',
  90: 'Últimos 3 meses',
  365: 'Último año',
  0: 'Desde el principio',
};

/** What the owner decided about a missing item. An item with no decision is still pending. */
export const MISSING_STATUSES = ['pending', 'added', 'dismissed'] as const;
export type MissingStatus = (typeof MISSING_STATUSES)[number];

export const MISSING_STATUS_LABELS: Readonly<Record<MissingStatus, string>> = {
  pending: 'Pendiente',
  added: 'Ya lo vendemos',
  dismissed: 'Descartado',
};

/** One time a customer asked for something the store does not have. */
export interface MissingItemRequest {
  /** What the customer asked for, in their words: «taquete de 1/4», «pintura vinílica azul». */
  readonly description: string;
  /** How many the customer wanted, when they said. */
  readonly quantity: number | null;
  /** Brand, size, color or anything else that helps to order it. */
  readonly notes: string | null;
}

/** Every time the same thing was asked for, gathered. Two descriptions are the same thing when they only differ in accents, capitals or spaces. */
export interface MissingItemGroup {
  /** The description without accents, capitals or extra spaces: what the times are gathered by. */
  readonly key: string;
  /** The description as it was written the last time. */
  readonly description: string;
  readonly timesAsked: number;
  /** The quantities customers said, added up. Zero when nobody said one. */
  readonly quantityAsked: number;
  /** The notes of every time, without repeats, the newest first. */
  readonly notes: readonly string[];
  /** When it was asked for the first and the last time in the period, in ISO 8601. */
  readonly firstAskedAt: string;
  readonly lastAskedAt: string;
  readonly status: MissingStatus;
}

/** How many times something was asked for in one stretch of time: a week, or a day of the week. */
export interface MissingCount {
  /** `2026-11-16` for the week that starts that Monday, or `0` to `6` for Sunday to Saturday. */
  readonly key: string;
  readonly count: number;
}

/** The log of a period, ready to read and to chart. */
export interface MissingItemsReport {
  readonly period: MissingPeriod;
  /** Every item asked for, the most asked first. */
  readonly groups: readonly MissingItemGroup[];
  /** The times asked by week, from the oldest week of the period to this one, with the empty weeks too. */
  readonly byWeek: readonly MissingCount[];
  /** The times asked by day of the week, Sunday first. */
  readonly byWeekday: readonly MissingCount[];
  readonly totalRequests: number;
  /** When the report was made, in ISO 8601. */
  readonly generatedAt: string;
}

export type RecordMissingResult = { readonly status: 'recorded'; readonly timesAsked: number } | { readonly status: 'invalid'; readonly message: string };

export interface ResolveMissingRequest {
  readonly key: string;
  readonly status: MissingStatus;
}

export type MissingExportResult =
  | { readonly status: 'saved'; readonly path: string }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly message: string };

export const MISSING_CHANNELS = {
  record: 'missing:record',
  report: 'missing:report',
  resolve: 'missing:resolve',
  exportPdf: 'missing:export-pdf',
} as const;

/** The bridge of the log of missing items. */
export interface MissingItemsApi {
  /** Writes down one time a customer asked for something. Anyone signed in can. */
  record(request: MissingItemRequest): Promise<RecordMissingResult>;

  /** @returns the log of the period */
  report(period: MissingPeriod): Promise<MissingItemsReport>;

  /** Marks an item as sold now, dismissed, or pending again. Only the owner can. */
  resolve(request: ResolveMissingRequest): Promise<void>;

  /** Saves the log of the period as a PDF with its charts, where the person chooses. */
  exportPdf(period: MissingPeriod): Promise<MissingExportResult>;
}

/**
 * Gives the key two descriptions of the same thing share: without accents, capitals or extra spaces.
 *
 * @param description what was written
 * @returns the key, such as `pintura vinilica azul`
 */
export function missingItemKey(description: string): string {
  return description
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}
