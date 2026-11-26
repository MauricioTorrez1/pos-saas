import { createCoreCaller, type CoreResult } from '../catalog/core-api';
import type { PanelConfig } from '../config';
import type { GlobalPreview, GlobalRequest, GlobalSummary } from './types';

/** Stamping waits for the provider, which may take longer than a read. */
const STAMP_TIMEOUT_MS = 60_000;

/** A client of the invoicing endpoints bound to one request's token. Server-side only. */
export interface InvoicingApi {
  previewGlobal(request: GlobalRequest): Promise<CoreResult<GlobalPreview>>;
  issueGlobal(request: GlobalRequest, expectedSaleCount: number): Promise<CoreResult<GlobalSummary>>;
  listGlobals(): Promise<CoreResult<GlobalSummary[]>>;
}

/**
 * Creates a client of the global invoice endpoints (ADR 0080).
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
  };
}
