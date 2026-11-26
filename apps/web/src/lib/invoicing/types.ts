/** How often the global invoice is issued (ADR 0080). Monthly is the default until the accountant confirms it. */
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
  /** Where its cancellation stands, or `null` if nobody asked to cancel it (ADR 0082). */
  cancellationStatus: CancellationStatus | null;
  cancellationMotive: string | null;
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

// --- cancellation and credit notes (ADR 0082) -----------------------------------------------------------------------

/** Where a cancellation stands at the SAT. */
export type CancellationStatus = 'requested' | 'pending' | 'accepted' | 'rejected' | 'failed';

/** Which CFDI a cancellation is about. */
export type CfdiKind = 'invoice' | 'global';

/** SAT motives to cancel a CFDI and who may use them: 01 to 03 an individual invoice; 02 to 04 a global. */
export const CANCELLATION_MOTIVES: Record<CfdiKind, readonly string[]> = {
  invoice: ['01', '02', '03'],
  global: ['02', '03', '04'],
};

export const MOTIVE_LABELS: Record<string, string> = {
  '01': '01 · Con errores, ya sustituida por otra factura',
  '02': '02 · Con errores, sin sustituir',
  '03': '03 · La operación no se llevó a cabo',
  '04': '04 · Una venta de la global se facturó aparte',
};

/** An individual invoice as the core lists it (`GET /invoices`). */
export interface InvoiceRow {
  id: string;
  saleId: string;
  folio: number;
  status: 'pending' | 'stamped' | 'failed';
  receiverTaxId: string;
  fiscalUuid: string | null;
  totalCents: number | null;
  /** The invoice this one replaces (motive 01), or `null`. */
  replacesInvoiceId: string | null;
  /** Whether a cancellation stopped it from covering the sale. */
  superseded: boolean;
  cancellationStatus: CancellationStatus | null;
  cancellationMotive: string | null;
  createdAt: string;
}

/** Where a cancellation stands after asking for it or refreshing it. */
export interface CancellationView {
  id: string;
  kind: 'invoice' | 'global_invoice';
  fiscalUuid: string | null;
  cancellationStatus: CancellationStatus | null;
  motive: string | null;
  substituteFiscalUuid: string | null;
}

/** A credit note, or a return of an invoiced sale that may get one (`creditNoteId` is `null`). */
export interface CreditNoteView {
  returnId: string;
  saleId: string;
  folio: number;
  refundCents: number;
  target: 'invoice' | 'global_invoice';
  relatedFiscalUuid: string;
  creditNoteId: string | null;
  status: 'pending' | 'stamped' | 'failed' | null;
  fiscalUuid: string | null;
  errorCode: string | null;
}

/** What a cancellation or credit note form shows after an action. */
export interface CfdiActionState {
  done: string | null;
  error: string | null;
  /** The provider's own words when it refused; shown as they come. */
  providerMessage: string | null;
}

export const EMPTY_CFDI_STATE: CfdiActionState = { done: null, error: null, providerMessage: null };

/** The fiscal data of the receiver of a replacement invoice. */
export interface ReceiverData {
  legalName: string;
  taxId: string;
  taxRegime: string;
  cfdiUse: string;
  zipCode: string;
}

/** What the core answers when it stamps an individual invoice. */
export interface InvoiceResult {
  invoiceId: string;
  saleId: string;
  status: string;
  fiscalUuid: string | null;
  providerInvoiceId: string | null;
  totalCents: number;
}
