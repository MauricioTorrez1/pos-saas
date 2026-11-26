/** How often the global invoice is issued (ADR 0077). Monthly is the default until the accountant confirms it. */
export const PERIODICITIES = ['monthly', 'biweekly', 'daily'] as const;
export type Periodicity = (typeof PERIODICITIES)[number];

export const PERIODICITY_LABELS: Record<Periodicity, string> = {
  monthly: 'Mensual',
  biweekly: 'Quincenal',
  daily: 'Diaria',
};

/** The totals of one tax rate in the preview, in cents. `taxRateBasisPoints` is `null` for exempt sales. */
export interface RateTotal {
  taxRateBasisPoints: number | null;
  baseCents: number;
  taxCents: number;
  totalCents: number;
}

/** One sale the global would hold. */
export interface GlobalSaleRow {
  saleId: string;
  folio: number;
  day: string;
  totalCents: number;
}

/** A global invoice as the core lists it (`GET /invoices/global`). */
export interface GlobalSummary {
  id: string;
  periodicity: string;
  periodStart: string;
  periodEnd: string;
  status: 'pending' | 'stamped' | 'failed';
  saleCount: number;
  expectedTotalCents: number;
  totalCents: number | null;
  fiscalUuid: string | null;
  providerInvoiceId: string | null;
  errorCode: string | null;
  /** Sales invoiced on their own after this global; above zero it must be cancelled with motive 04 and reissued. */
  overlappingInvoices: number;
}

/** What the global of a period would hold (`GET /invoices/global/preview`). */
export interface GlobalPreview {
  periodicity: Periodicity;
  periodStart: string;
  periodEnd: string;
  closed: boolean;
  deadline: string;
  saleCount: number;
  totalCents: number;
  byRate: RateTotal[];
  paymentForm: string;
  individuallyInvoiced: number;
  existing: GlobalSummary | null;
  sales: GlobalSaleRow[];
}

/** The period the owner asked for. */
export interface GlobalRequest {
  periodicity: Periodicity;
  day: string;
}

/** What the global invoice screen shows after an action. */
export interface GlobalInvoiceState {
  preview: { request: GlobalRequest; result: GlobalPreview } | null;
  issued: GlobalSummary | null;
  error: string | null;
  /** The provider's own words when it refused the invoice; shown as they come. */
  providerMessage: string | null;
}

export const EMPTY_GLOBAL_STATE: GlobalInvoiceState = { preview: null, issued: null, error: null, providerMessage: null };
