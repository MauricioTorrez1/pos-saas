import type { PanelConfig } from './config';

/** A product as the label screen lists it. */
export interface LabelCandidate {
  id: string;
  name: string;
  code: string | null;
  unitPrice: string;
  unit: string;
}

/** Outcome of searching the products to label (`GET /products?q=`). */
export type CandidateSearch =
  | { status: 'ok'; items: LabelCandidate[]; total: number }
  | { status: 'unauthorized' }
  | { status: 'forbidden' }
  | { status: 'unavailable' };

/** What to print, as `POST /labels` takes it (ADR 0065). */
export type LabelsRequest =
  | { productIds: string[]; copies: number }
  | { search: string; copies: number };

/** Outcome of asking the core for the file of labels. */
export type LabelsResult =
  | { status: 'ok'; file: ArrayBuffer; contentType: string; fileName: string; labels: number }
  | { status: 'invalid'; message: string }
  | { status: 'unauthorized' }
  | { status: 'forbidden' }
  | { status: 'unavailable' };

/** Same bounds as the core: from 1 to 24 copies of each label. */
export const MAX_COPIES = 24;
/** How many matches the screen lists at once. */
export const SEARCH_PAGE_SIZE = 50;

const SEARCH_TIMEOUT_MS = 5000;
const PRINT_TIMEOUT_MS = 30000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function statusOnly(status: number): { status: 'unauthorized' } | { status: 'forbidden' } | { status: 'unavailable' } {
  if (status === 401) {
    return { status: 'unauthorized' };
  }
  if (status === 403) {
    return { status: 'forbidden' };
  }
  return { status: 'unavailable' };
}

interface ProductItem {
  id?: unknown;
  name?: unknown;
  unitPrice?: unknown;
  unit?: unknown;
  codes?: { code?: unknown; kind?: unknown }[];
}

function toCandidate(item: ProductItem): LabelCandidate | null {
  if (typeof item.id !== 'string' || typeof item.name !== 'string') {
    return null;
  }
  const codes = Array.isArray(item.codes) ? item.codes : [];
  const barcode = codes.find((code) => code.kind === 'barcode') ?? codes[0];
  return {
    id: item.id,
    name: item.name,
    code: typeof barcode?.code === 'string' ? barcode.code : null,
    unitPrice: typeof item.unitPrice === 'string' ? item.unitPrice : '0',
    unit: typeof item.unit === 'string' ? item.unit : 'piece',
  };
}

/**
 * Searches the products to label by name or exact code. Server-side only: the token never reaches the browser.
 *
 * @param config - Panel settings.
 * @param accessToken - Access token of the session.
 * @param query - Words of the name or an exact code.
 * @param fetcher - HTTP client; tests pass a fake.
 * @returns The first matches and the total, or why there are none.
 */
export async function searchCandidates(
  config: PanelConfig,
  accessToken: string,
  query: string,
  fetcher: typeof fetch = fetch,
): Promise<CandidateSearch> {
  const url = new URL('/products', config.coreApiUrl);
  url.searchParams.set('q', query);
  url.searchParams.set('size', String(SEARCH_PAGE_SIZE));
  try {
    const response = await fetcher(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      return statusOnly(response.status);
    }
    const body = (await response.json()) as { items?: ProductItem[]; total?: unknown };
    const items = (Array.isArray(body.items) ? body.items : []).map(toCandidate).filter((item) => item !== null);
    return { status: 'ok', items, total: typeof body.total === 'number' ? body.total : items.length };
  } catch {
    return { status: 'unavailable' };
  }
}

/**
 * Reads the form of the label screen.
 *
 * @param form - The submitted form: `mode` is `chosen` or `search`, with `productId` (repeated), `q` and `copies`.
 * @returns What to print, or a message for the user when the form makes no sense.
 */
export function parseLabelsForm(form: FormData): LabelsRequest | { error: string } {
  const copies = Number(form.get('copies') ?? '1');
  if (!Number.isInteger(copies) || copies < 1 || copies > MAX_COPIES) {
    return { error: `Las copias van de 1 a ${MAX_COPIES}.` };
  }
  if (form.get('mode') === 'search') {
    const search = String(form.get('q') ?? '').trim();
    return search ? { search, copies } : { error: 'Escribe una búsqueda.' };
  }
  const productIds = form
    .getAll('productId')
    .map(String)
    .filter((id) => UUID_PATTERN.test(id));
  return productIds.length > 0 ? { productIds, copies } : { error: 'Elige al menos un producto.' };
}

function fileNameOf(disposition: string | null): string {
  const match = disposition?.match(/filename="?([^";]+)"?/);
  return match?.[1] ?? 'etiquetas.pdf';
}

/**
 * Asks the core for the file of labels (`POST /labels`). Server-side only.
 *
 * @param config - Panel settings.
 * @param accessToken - Access token of the session.
 * @param request - What to print.
 * @param fetcher - HTTP client; tests pass a fake.
 * @returns The file, the reason the core refused it, or why it could not be reached.
 */
export async function requestLabels(
  config: PanelConfig,
  accessToken: string,
  request: LabelsRequest,
  fetcher: typeof fetch = fetch,
): Promise<LabelsResult> {
  try {
    const response = await fetcher(new URL('/labels', config.coreApiUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/pdf, application/problem+json',
      },
      body: JSON.stringify(request),
      cache: 'no-store',
      signal: AbortSignal.timeout(PRINT_TIMEOUT_MS),
    });
    if (response.status === 400 || response.status === 404) {
      const problem = (await response.json().catch(() => ({}))) as { detail?: unknown };
      const message =
        response.status === 404
          ? 'Uno de los productos ya no existe. Vuelve a buscar.'
          : typeof problem.detail === 'string'
            ? problem.detail
            : 'El sistema no aceptó la petición.';
      return { status: 'invalid', message };
    }
    if (!response.ok) {
      return statusOnly(response.status);
    }
    return {
      status: 'ok',
      file: await response.arrayBuffer(),
      contentType: response.headers.get('Content-Type') ?? 'application/pdf',
      fileName: fileNameOf(response.headers.get('Content-Disposition')),
      labels: Number(response.headers.get('X-Label-Count') ?? '0'),
    };
  } catch {
    return { status: 'unavailable' };
  }
}

/**
 * Formats a price of the core, in pesos with up to four decimals, as the label prints it.
 *
 * @param unitPrice - Price with VAT as text, such as `135.5000`.
 * @param unit - Base unit of the product: `piece`, `meter`, `kilogram` or `liter`.
 * @returns Such as `$135.50` or `$12.50 / m`; `Sin precio` when it is zero or unreadable.
 */
export function formatLabelPrice(unitPrice: string, unit: string): string {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(unitPrice);
  if (!match) {
    return 'Sin precio';
  }
  // Integer arithmetic in ten-thousandths, rounded half up to the cent, like the core (ADR 0011).
  const e4 = BigInt(match[1] ?? '0') * 10000n + BigInt((match[2] ?? '').padEnd(4, '0'));
  if (e4 === 0n) {
    return 'Sin precio';
  }
  const cents = (e4 + 50n) / 100n;
  const pesos = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const suffix: Record<string, string> = { meter: ' / m', kilogram: ' / kg', liter: ' / L' };
  return `$${pesos}.${(cents % 100n).toString().padStart(2, '0')}${suffix[unit] ?? ''}`;
}
