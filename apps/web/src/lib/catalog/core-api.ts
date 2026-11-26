import type { PanelConfig } from '../config';
import type {
  ImportReport,
  PriceChangeRequest,
  PriceChangeResult,
  Product,
  ProductPage,
  ProductRequest,
} from './types';

/** Outcome of a call to the core: the body on success, or what went wrong. */
export type CoreResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      /** HTTP status, or `0` when the core did not answer at all. */
      status: number;
      /** `detail` of the `application/problem+json` answer, when there is one. */
      detail: string | null;
      /** The whole problem body, for fields such as `actualCount` or `code`. */
      problem: Record<string, unknown>;
    };

/** Products per page of the list. The core accepts up to 100. */
export const PAGE_SIZE = 50;

const REQUEST_TIMEOUT_MS = 15_000;
const IMPORT_TIMEOUT_MS = 120_000;

/** A client bound to the core address and the access token of one request. Server-side only. */
export interface CoreApi {
  listProducts(query: string, page: number): Promise<CoreResult<ProductPage>>;
  getProduct(id: string): Promise<CoreResult<Product>>;
  createProduct(idempotencyKey: string, request: ProductRequest): Promise<CoreResult<Product>>;
  updateProduct(id: string, request: ProductRequest): Promise<CoreResult<Product>>;
  changePrice(id: string, unitPrice: string): Promise<CoreResult<Product>>;
  deleteProduct(id: string): Promise<CoreResult<null>>;
  importCatalog(csv: string, dryRun: boolean): Promise<CoreResult<ImportReport>>;
  previewPriceChange(request: PriceChangeRequest): Promise<CoreResult<PriceChangeResult>>;
  applyPriceChange(request: PriceChangeRequest, expectedCount: number): Promise<CoreResult<PriceChangeResult>>;
}

async function readProblem(response: Response): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await response.json();
    return body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Options of one call to the core. */
export interface CoreCallInit {
  method?: string;
  body?: string;
  contentType?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

/**
 * Creates the function every client of the core uses: it adds the token, reads `application/problem+json` failures and
 * turns a network error or a timeout into `{ ok: false, status: 0 }`. Server-side only.
 *
 * @param config - Panel settings; only `coreApiUrl` is used.
 * @param accessToken - Access token of the session.
 * @param fetcher - HTTP client; tests pass a fake.
 */
export function createCoreCaller(config: PanelConfig, accessToken: string, fetcher: typeof fetch = fetch) {
  return async function call<T>(path: string, init: CoreCallInit = {}): Promise<CoreResult<T>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...init.headers,
    };
    if (init.body !== undefined) {
      headers['Content-Type'] = init.contentType ?? 'application/json';
    }
    try {
      const response = await fetcher(new URL(path, config.coreApiUrl), {
        method: init.method ?? 'GET',
        headers,
        body: init.body,
        cache: 'no-store',
        signal: AbortSignal.timeout(init.timeoutMs ?? REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        const problem = await readProblem(response);
        return {
          ok: false,
          status: response.status,
          detail: typeof problem.detail === 'string' ? problem.detail : null,
          problem,
        };
      }
      if (response.status === 204) {
        return { ok: true, data: null as T };
      }
      return { ok: true, data: (await response.json()) as T };
    } catch {
      return { ok: false, status: 0, detail: null, problem: {} };
    }
  };
}

/**
 * Creates a client of the catalog endpoints. The token goes only from this server to the core, never to the browser.
 *
 * A network error or a timeout becomes `{ ok: false, status: 0 }`, so a screen can explain it instead of failing.
 *
 * @param config - Panel settings; only `coreApiUrl` is used.
 * @param accessToken - Access token of the session.
 * @param fetcher - HTTP client; tests pass a fake.
 */
export function createCoreApi(config: PanelConfig, accessToken: string, fetcher: typeof fetch = fetch): CoreApi {
  const call = createCoreCaller(config, accessToken, fetcher);

  const json = (method: string, body: unknown, headers?: Record<string, string>) => ({
    method,
    body: JSON.stringify(body),
    headers,
  });

  return {
    listProducts(query, page) {
      const params = new URLSearchParams({ page: String(page), size: String(PAGE_SIZE) });
      if (query.trim()) {
        params.set('q', query.trim());
      }
      return call<ProductPage>(`/products?${params.toString()}`);
    },
    getProduct(id) {
      return call<Product>(`/products/${encodeURIComponent(id)}`);
    },
    createProduct(idempotencyKey, request) {
      return call<Product>('/products', json('POST', request, { 'Idempotency-Key': idempotencyKey }));
    },
    updateProduct(id, request) {
      return call<Product>(`/products/${encodeURIComponent(id)}`, json('PATCH', request));
    },
    changePrice(id, unitPrice) {
      return call<Product>(`/products/${encodeURIComponent(id)}/price`, json('PATCH', { unitPrice }));
    },
    deleteProduct(id) {
      return call<null>(`/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
    importCatalog(csv, dryRun) {
      return call<ImportReport>(`/imports/catalog?dryRun=${dryRun}`, {
        method: 'POST',
        body: csv,
        contentType: 'text/csv; charset=utf-8',
        timeoutMs: IMPORT_TIMEOUT_MS,
      });
    },
    previewPriceChange(request) {
      return call<PriceChangeResult>('/price-changes', json('POST', { ...request, preview: true }));
    },
    applyPriceChange(request, expectedCount) {
      return call<PriceChangeResult>('/price-changes', json('POST', { ...request, preview: false, expectedCount }));
    },
  };
}

/**
 * Turns a failed call into a sentence for the owner.
 *
 * @param result - The failed call.
 * @param fallback - What to say for a 400 without a better message.
 */
export function failureMessage(result: Extract<CoreResult<unknown>, { ok: false }>, fallback: string): string {
  switch (result.status) {
    case 0:
      return 'No pudimos hablar con el sistema central. Revisa tu conexión e inténtalo de nuevo.';
    case 401:
      return 'Tu sesión terminó. Vuelve a iniciar sesión.';
    case 403:
      return 'Tu rol no permite hacer esto.';
    case 404:
      return 'El producto ya no existe; quizá alguien lo dio de baja.';
    default:
      if (result.status >= 500) {
        return 'El sistema central tuvo un problema. Inténtalo en unos minutos.';
      }
      return result.detail ? `${fallback} (${result.detail})` : fallback;
  }
}
