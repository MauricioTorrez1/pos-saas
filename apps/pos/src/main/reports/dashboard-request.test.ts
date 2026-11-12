import { describe, expect, it } from 'vitest';

import { parseDashboardRequest, parseExportFormat } from './dashboard-request';

const VALID = { period: 'week', date: '2026-11-10', topMetric: 'amount', topLimit: 20 };

describe('the request of the dashboard that crosses the bridge', () => {
  it('keeps only the fields it knows', () => {
    expect(parseDashboardRequest({ ...VALID, ownerPin: '4321', extra: 'ignored' })).toEqual({ ...VALID, ownerPin: '4321' });
    expect(parseDashboardRequest({ ...VALID, period: 'custom', endDate: '2026-11-12' })).toMatchObject({ period: 'custom', endDate: '2026-11-12' });
  });

  it.each([
    ['not an object', 'hoy'],
    ['an array', []],
    ['a period it does not know', { ...VALID, period: 'decade' }],
    ['an order it does not know', { ...VALID, topMetric: 'margin' }],
    ['a size it does not know', { ...VALID, topLimit: 100 }],
    ['a size as text', { ...VALID, topLimit: '10' }],
    ['a day that is not text', { ...VALID, date: 20_261_110 }],
    ['a day with the wrong length', { ...VALID, date: '2026-1-1' }],
    ['a last day that is not text', { ...VALID, endDate: 5 }],
    ['a PIN that is not text', { ...VALID, ownerPin: 4321 }],
    ['a PIN that is far too long', { ...VALID, ownerPin: '1'.repeat(100) }],
  ])('refuses %s', (_description, value) => {
    expect(() => parseDashboardRequest(value)).toThrow(TypeError);
  });

  it('accepts only the two formats of the files', () => {
    expect(parseExportFormat('xlsx')).toBe('xlsx');
    expect(parseExportFormat('pdf')).toBe('pdf');
    expect(() => parseExportFormat('csv')).toThrow(TypeError);
    expect(() => parseExportFormat(undefined)).toThrow(TypeError);
  });
});
