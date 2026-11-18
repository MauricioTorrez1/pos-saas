import { describe, expect, it, vi } from 'vitest';
import type { PanelConfig } from './config';
import { formatLabelPrice, parseLabelsForm, requestLabels, searchCandidates } from './labels';

const config = { coreApiUrl: new URL('http://core.test:8080') } as PanelConfig;
const ID_A = '0192f3a4-0000-7000-8000-00000000000a';
const ID_B = '0192f3a4-0000-7000-8000-00000000000b';

function form(entries: [string, string][]): FormData {
  const data = new FormData();
  entries.forEach(([name, value]) => data.append(name, value));
  return data;
}

describe('parseLabelsForm', () => {
  it('reads the chosen products and the copies', () => {
    expect(parseLabelsForm(form([['mode', 'chosen'], ['productId', ID_A], ['productId', ID_B], ['copies', '3']]))).toEqual({
      productIds: [ID_A, ID_B],
      copies: 3,
    });
  });

  it('reads every match of the search', () => {
    expect(parseLabelsForm(form([['mode', 'search'], ['q', ' martillo '], ['copies', '1']]))).toEqual({
      search: 'martillo',
      copies: 1,
    });
  });

  it('refuses no choice, a blank search, bad copies, and ids that are not UUIDs', () => {
    expect(parseLabelsForm(form([['mode', 'chosen'], ['productId', 'x']]))).toEqual({ error: 'Elige al menos un producto.' });
    expect(parseLabelsForm(form([['mode', 'search'], ['q', ' ']]))).toEqual({ error: 'Escribe una búsqueda.' });
    expect(parseLabelsForm(form([['productId', ID_A], ['copies', '25']]))).toMatchObject({ error: expect.any(String) });
    expect(parseLabelsForm(form([['productId', ID_A], ['copies', '1.5']]))).toMatchObject({ error: expect.any(String) });
  });
});

describe('searchCandidates', () => {
  it('asks the core with the token and keeps the barcode of each product', async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        items: [
          {
            id: ID_A,
            name: 'Martillo',
            unitPrice: '135.5000',
            unit: 'piece',
            codes: [
              { code: 'ALT-1', kind: 'alternate' },
              { code: '7501031311309', kind: 'barcode' },
            ],
          },
          { id: ID_B, name: 'Sin código', unitPrice: '1.0000', unit: 'meter', codes: [] },
        ],
        total: 2,
      }),
    ) as typeof fetch;

    const result = await searchCandidates(config, 'the-token', 'mar tillo', fetcher);

    expect(result).toEqual({
      status: 'ok',
      total: 2,
      items: [
        { id: ID_A, name: 'Martillo', code: '7501031311309', unitPrice: '135.5000', unit: 'piece' },
        { id: ID_B, name: 'Sin código', code: null, unitPrice: '1.0000', unit: 'meter' },
      ],
    });
    const [url, init] = vi.mocked(fetcher).mock.calls[0] ?? [];
    expect(String(url)).toBe('http://core.test:8080/products?q=mar+tillo&size=50');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer the-token');
  });

  it('maps the failures', async () => {
    const failing = (status: number) => vi.fn(async () => new Response(null, { status })) as typeof fetch;

    expect(await searchCandidates(config, 't', 'x', failing(401))).toEqual({ status: 'unauthorized' });
    expect(await searchCandidates(config, 't', 'x', failing(403))).toEqual({ status: 'forbidden' });
    expect(await searchCandidates(config, 't', 'x', failing(500))).toEqual({ status: 'unavailable' });
    const offline = vi.fn(async () => Promise.reject(new TypeError('fetch failed'))) as typeof fetch;
    expect(await searchCandidates(config, 't', 'x', offline)).toEqual({ status: 'unavailable' });
  });
});

describe('requestLabels', () => {
  it('posts the request and returns the file with its name and count', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(new Uint8Array([37, 80, 68, 70]), {
          headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="etiquetas.pdf"',
            'X-Label-Count': '6',
          },
        }),
    ) as typeof fetch;

    const result = await requestLabels(config, 'the-token', { productIds: [ID_A], copies: 6 }, fetcher);

    expect(result).toMatchObject({ status: 'ok', contentType: 'application/pdf', fileName: 'etiquetas.pdf', labels: 6 });
    const [url, init] = vi.mocked(fetcher).mock.calls[0] ?? [];
    expect(String(url)).toBe('http://core.test:8080/labels');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe(JSON.stringify({ productIds: [ID_A], copies: 6 }));
  });

  it('passes on why the core refused the request', async () => {
    const refused = vi.fn(async () =>
      Response.json({ detail: 'Serían 300 etiquetas y un archivo lleva 240 como máximo' }, { status: 400 }),
    ) as typeof fetch;
    const missing = vi.fn(async () => new Response(null, { status: 404 })) as typeof fetch;

    expect(await requestLabels(config, 't', { search: 'x', copies: 1 }, refused)).toEqual({
      status: 'invalid',
      message: 'Serían 300 etiquetas y un archivo lleva 240 como máximo',
    });
    expect(await requestLabels(config, 't', { productIds: [ID_A], copies: 1 }, missing)).toMatchObject({ status: 'invalid' });
  });
});

describe('formatLabelPrice', () => {
  it('rounds to the cent like the core and adds the unit', () => {
    expect(formatLabelPrice('135.5000', 'piece')).toBe('$135.50');
    expect(formatLabelPrice('12.3456', 'meter')).toBe('$12.35 / m');
    expect(formatLabelPrice('1250', 'kilogram')).toBe('$1,250.00 / kg');
    expect(formatLabelPrice('0.0000', 'piece')).toBe('Sin precio');
    expect(formatLabelPrice('abc', 'piece')).toBe('Sin precio');
  });
});
