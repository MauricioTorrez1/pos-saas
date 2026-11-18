import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../config';
import { createCoreApi, failureMessage } from './core-api';

const config = loadConfig({
  PANEL_OIDC_ISSUER_URL: 'http://localhost:8180/realms/pos',
  PANEL_BASE_URL: 'http://localhost:3000',
  PANEL_CORE_API_URL: 'http://core.test',
  PANEL_SESSION_SECRET: 'x'.repeat(32),
} as unknown as NodeJS.ProcessEnv);

function answer(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function recordingFetch(response: Response) {
  const fetcher = vi.fn<typeof fetch>(async () => response);
  const lastCall = () => {
    const [url, init] = fetcher.mock.calls.at(-1) ?? [];
    return { url: String(url), init: init ?? {}, headers: (init?.headers ?? {}) as Record<string, string> };
  };
  return { fetcher, lastCall };
}

describe('createCoreApi', () => {
  it('searches one page with the bearer token and the page size of the panel', async () => {
    const { fetcher, lastCall } = recordingFetch(answer(200, { items: [], page: 2, size: 50, total: 0 }));

    const result = await createCoreApi(config, 'token-1', fetcher).listProducts(' cable ', 2);

    expect(result).toEqual({ ok: true, data: { items: [], page: 2, size: 50, total: 0 } });
    expect(lastCall().url).toBe('http://core.test/products?page=2&size=50&q=cable');
    expect(lastCall().headers.Authorization).toBe('Bearer token-1');
  });

  it('sends the idempotency key when it creates a product', async () => {
    const { fetcher, lastCall } = recordingFetch(answer(201, { id: 'p1' }));

    await createCoreApi(config, 't', fetcher).createProduct('key-1', {
      name: 'Lija',
      unit: 'piece',
      codes: [],
      presentations: [],
      taxFactor: 'rate',
      taxRateBp: 1600,
      satProductKey: '',
      satUnitKey: '',
    });

    expect(lastCall().init.method).toBe('POST');
    expect(lastCall().headers['Idempotency-Key']).toBe('key-1');
    expect(JSON.parse(String(lastCall().init.body))).toMatchObject({ name: 'Lija' });
  });

  it('sends the file as CSV text for a dry run', async () => {
    const { fetcher, lastCall } = recordingFetch(answer(200, { rowsRead: 1 }));

    await createCoreApi(config, 't', fetcher).importCatalog('codigo,nombre,precio\n', true);

    expect(lastCall().url).toBe('http://core.test/imports/catalog?dryRun=true');
    expect(lastCall().headers['Content-Type']).toBe('text/csv; charset=utf-8');
    expect(lastCall().init.body).toBe('codigo,nombre,precio\n');
  });

  it('applies a price change with the count of the preview', async () => {
    const { fetcher, lastCall } = recordingFetch(answer(200, { applied: true, count: 3, lines: [] }));

    await createCoreApi(config, 't', fetcher).applyPriceChange({ search: 'truper', percent: '5', rounding: 'peso' }, 3);

    expect(JSON.parse(String(lastCall().init.body))).toEqual({
      search: 'truper',
      percent: '5',
      rounding: 'peso',
      preview: false,
      expectedCount: 3,
    });
  });

  it('keeps the problem of a stale preview, so the screen can show the new count', async () => {
    const { fetcher } = recordingFetch(answer(409, { detail: 'stale', expectedCount: 3, actualCount: 4 }));

    const result = await createCoreApi(config, 't', fetcher).applyPriceChange(
      { search: '', percent: '5', rounding: 'cent' },
      3,
    );

    expect(result).toEqual({ ok: false, status: 409, detail: 'stale', problem: { detail: 'stale', expectedCount: 3, actualCount: 4 } });
  });

  it('treats a delete without body as success', async () => {
    const { fetcher } = recordingFetch(new Response(null, { status: 204 }));

    expect(await createCoreApi(config, 't', fetcher).deleteProduct('p1')).toEqual({ ok: true, data: null });
  });

  it('turns a network error into status 0 instead of throwing', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed');
    });

    const result = await createCoreApi(config, 't', fetcher).getProduct('p1');

    expect(result).toEqual({ ok: false, status: 0, detail: null, problem: {} });
  });
});

describe('failureMessage', () => {
  const failure = (status: number, detail: string | null = null) => ({ ok: false as const, status, detail, problem: {} });

  it('explains each kind of failure in Spanish', () => {
    expect(failureMessage(failure(0), 'x')).toMatch(/No pudimos hablar/);
    expect(failureMessage(failure(403), 'x')).toMatch(/Tu rol/);
    expect(failureMessage(failure(503), 'x')).toMatch(/tuvo un problema/);
  });

  it('adds the detail of the core to a rejected request', () => {
    expect(failureMessage(failure(400, 'unit must be piece'), 'No se guardó.')).toBe('No se guardó. (unit must be piece)');
  });
});
