import { createCoreCaller, type CoreResult } from '../catalog/core-api';
import type { PanelConfig } from '../config';
import type {
  CancellationView,
  CfdiKind,
  CreditNoteView,
  GlobalPreview,
  GlobalRequest,
  GlobalSummary,
  InvoiceResult,
  InvoiceRow,
  ReceiverData,
} from './types';

/** Stamping waits for the provider, which may take longer than a read. */
const STAMP_TIMEOUT_MS = 60_000;

/** A client of the invoicing endpoints bound to one request's token. Server-side only. */
export interface InvoicingApi {
  previewGlobal(request: GlobalRequest): Promise<CoreResult<GlobalPreview>>;
  issueGlobal(request: GlobalRequest, expectedSaleCount: number): Promise<CoreResult<GlobalSummary>>;
  listGlobals(): Promise<CoreResult<GlobalSummary[]>>;
  listInvoices(): Promise<CoreResult<InvoiceRow[]>>;
  replaceInvoice(saleId: string, replacesInvoiceId: string, receiver: ReceiverData): Promise<CoreResult<InvoiceResult>>;
  cancel(kind: CfdiKind, id: string, motive: string, substituteFiscalUuid: string | null): Promise<CoreResult<CancellationView>>;
  refreshCancellation(kind: CfdiKind, id: string): Promise<CoreResult<CancellationView>>;
  creditNoteCandidates(): Promise<CoreResult<CreditNoteView[]>>;
  recentCreditNotes(): Promise<CoreResult<CreditNoteView[]>>;
  issueCreditNote(returnId: string): Promise<CoreResult<CreditNoteView>>;
}

/** The path of a CFDI: individual invoices live under `/invoices/{id}`, globals under `/invoices/global/{id}`. */
function cfdiPath(kind: CfdiKind, id: string): string {
  const prefix = kind === 'global' ? '/invoices/global/' : '/invoices/';
  return prefix + encodeURIComponent(id);
}

/**
 * Creates a client of the invoicing endpoints: the global invoice (ADR 0080), cancellations and credit notes (ADR 0082).
 *
 * @param config - Panel settings; only `coreApiUrl` is used.
 * @param accessToken - Access token of the session.
 * @param fetcher - HTTP client; tests pass a fake.
 */
export function createInvoicingApi(config: PanelConfig, accessToken: string, fetcher: typeof fetch = fetch): InvoicingApi {
  const call = createCoreCaller(config, accessToken, fetcher);
  return {
    previewGlobal(request) {
      const params = new URLSearchParams({ periodicity: request.periodicity, day: request.day });
      return call<GlobalPreview>(`/invoices/global/preview?${params.toString()}`);
    },
    issueGlobal(request, expectedSaleCount) {
      return call<GlobalSummary>('/invoices/global', {
        method: 'POST',
        body: JSON.stringify({ ...request, expectedSaleCount }),
        timeoutMs: STAMP_TIMEOUT_MS,
      });
    },
    listGlobals() {
      return call<GlobalSummary[]>('/invoices/global');
    },
    listInvoices() {
      return call<InvoiceRow[]>('/invoices');
    },
    replaceInvoice(saleId, replacesInvoiceId, receiver) {
      return call<InvoiceResult>('/invoices', {
        method: 'POST',
        body: JSON.stringify({ saleId, replacesInvoiceId, receiver }),
        timeoutMs: STAMP_TIMEOUT_MS,
      });
    },
    cancel(kind, id, motive, substituteFiscalUuid) {
      return call<CancellationView>(`${cfdiPath(kind, id)}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ motive, substituteFiscalUuid }),
        timeoutMs: STAMP_TIMEOUT_MS,
      });
    },
    refreshCancellation(kind, id) {
      return call<CancellationView>(`${cfdiPath(kind, id)}/cancellation-refresh`, { method: 'POST' });
    },
    creditNoteCandidates() {
      return call<CreditNoteView[]>('/invoices/credit-notes/candidates');
    },
    recentCreditNotes() {
      return call<CreditNoteView[]>('/invoices/credit-notes');
    },
    issueCreditNote(returnId) {
      return call<CreditNoteView>('/invoices/credit-notes', {
        method: 'POST',
        body: JSON.stringify({ returnId }),
        timeoutMs: STAMP_TIMEOUT_MS,
      });
    },
  };
}
