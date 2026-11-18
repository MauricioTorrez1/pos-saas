import { describe, expect, it } from 'vitest';
import type { PanelConfig } from '../config';
import { readCatalogPage } from './analytics-client';
import {
  approveRow,
  formatCostE6,
  parseCostE6,
  priceListCsv,
  priceListFileName,
  toReviewRow,
  type ProposedRow,
} from './rows';

const proposed: ProposedRow = {
  supplier_code: 'TB-12',
  description: 'Tubo PVC 1/2", "hidráulico"',
  purchase_unit: 'caja',
  pieces_per_unit: 12,
  cost_e6: '1234500000',
  price_text: '$1,234.50',
  confidence: 'high',
  issues: [],
};

describe('costs', () => {
  it('reads typed pesos as exact millionths', () => {
    expect(parseCostE6('$1,234.5')).toBe(1_234_500_000n);
    expect(parseCostE6('0.123456')).toBe(123_456n);
    expect(parseCostE6('0')).toBeNull();
    expect(parseCostE6('1.1234567')).toBeNull();
    expect(parseCostE6('12,5')).toBeNull();
  });

  it('writes millionths with two to six decimals', () => {
    expect(formatCostE6(1_234_500_000n)).toBe('1234.50');
    expect(formatCostE6(12_345_000n)).toBe('12.345');
  });
});

describe('review rows', () => {
  it('starts unapproved with the cost as text', () => {
    const row = toReviewRow(proposed, 'r1');
    expect(row).toMatchObject({ supplierCode: 'TB-12', pieces: '12', cost: '1234.50', approved: false });
  });

  it('leaves an unreadable cost blank and refuses to approve it', () => {
    const row = toReviewRow({ ...proposed, cost_e6: null, pieces_per_unit: null }, 'r2');
    expect(row.cost).toBe('');
    expect(approveRow(row)).toEqual({ error: 'Escribe cuántas piezas trae (1 si se vende por pieza).' });
    expect(approveRow({ ...row, pieces: '1' })).toEqual({ error: 'Escribe el costo sin IVA, con hasta 6 decimales.' });
  });

  it('approves a complete row with an integer cost', () => {
    const checked = approveRow(toReviewRow(proposed, 'r3'));
    expect(checked).toEqual({
      row: { supplierCode: 'TB-12', description: proposed.description, purchaseUnit: 'caja', pieces: 12, costE6: 1_234_500_000n },
    });
  });
});

describe('price list CSV', () => {
  it('writes the agreed header and quotes cells with commas or quotes', () => {
    const checked = approveRow(toReviewRow(proposed, 'r4'));
    if (!('row' in checked)) throw new Error('expected an approved row');
    expect(priceListCsv([checked.row])).toBe(
      'supplier_code,description,purchase_unit,pieces_per_unit,cost\r\nTB-12,"Tubo PVC 1/2"", ""hidráulico""",caja,12,1234.50\r\n',
    );
  });

  it('names the file after the supplier', () => {
    expect(priceListFileName('Truper Ñuñoa S.A.')).toBe('lista-truper-nunoa-s-a.csv');
    expect(priceListFileName('  ')).toBe('lista-proveedor.csv');
  });
});

describe('readCatalogPage', () => {
  const config = { analyticsApiUrl: new URL('http://analytics:8000') } as PanelConfig;

  it('forwards the photo with the session token', async () => {
    let seen: Request | undefined;
    const fetcher = (async (url: URL, init: RequestInit) => {
      seen = new Request(url, init);
      return Response.json({ rows: [proposed], vat_statement: 'excludes_vat' });
    }) as unknown as typeof fetch;

    const result = await readCatalogPage(config, 'token', new ArrayBuffer(4), 'image/jpeg', fetcher);

    expect(result).toEqual({ status: 'ok', rows: [proposed], vatStatement: 'excludes_vat' });
    expect(seen?.url).toBe('http://analytics:8000/catalog-pages/read');
    expect(seen?.headers.get('authorization')).toBe('Bearer token');
    expect(seen?.headers.get('content-type')).toBe('image/jpeg');
  });

  it('translates the error codes of the service', async () => {
    const fetcher = (async () => Response.json({ detail: 'photo_too_large' }, { status: 413 })) as unknown as typeof fetch;
    const result = await readCatalogPage(config, 't', new ArrayBuffer(1), 'image/png', fetcher);
    expect(result).toEqual({ status: 'error', httpStatus: 413, message: 'La foto pesa más de 5 MB. Tómala de nuevo o recórtala.' });
  });

  it('refuses when the service is not configured', async () => {
    const result = await readCatalogPage({ analyticsApiUrl: null } as PanelConfig, 't', new ArrayBuffer(1), 'image/png');
    expect(result.status).toBe('error');
  });
});
