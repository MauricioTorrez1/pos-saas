import { describe, expect, it, vi } from 'vitest';
import { canAccess } from '../access';
import type { PanelConfig } from '../config';
import { createInvoicingApi } from './invoicing-api';
import { defaultGlobalDay, formatCents, globalFailureMessage, rateLabel } from './messages';

const CONFIG = { coreApiUrl: 'http://core.test' } as unknown as PanelConfig;

describe('createInvoicingApi', () => {
  it('asks for the preview with the period and stamps with the count it showed', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ saleCount: 2 }), { status: 200 }));
    const api = createInvoicingApi(CONFIG, 'token', fetcher as unknown as typeof fetch);

    await api.previewGlobal({ periodicity: 'monthly', day: '2026-10-01' });
    await api.issueGlobal({ periodicity: 'monthly', day: '2026-10-01' }, 2);

    const [previewUrl, previewInit] = fetcher.mock.calls[0] as unknown as [URL, RequestInit];
    expect(previewUrl.toString()).toBe('http://core.test/invoices/global/preview?periodicity=monthly&day=2026-10-01');
    expect((previewInit.headers as Record<string, string>).Authorization).toBe('Bearer token');
    const [issueUrl, issueInit] = fetcher.mock.calls[1] as unknown as [URL, RequestInit];
    expect(issueUrl.pathname).toBe('/invoices/global');
    expect(issueInit.method).toBe('POST');
    expect(JSON.parse(issueInit.body as string)).toEqual({ periodicity: 'monthly', day: '2026-10-01', expectedSaleCount: 2 });
  });

  it('turns a problem answer into a failure with its code', async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify({ code: 'period_not_closed', detail: 'x' }), { status: 422 }),
    );
    const result = await createInvoicingApi(CONFIG, 'token', fetcher as unknown as typeof fetch).listGlobals();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(globalFailureMessage(result)).toContain('todavía no termina');
    }
  });
});

describe('global invoice messages', () => {
  it('formats cents without floats and names the rates', () => {
    expect(formatCents(116000)).toBe('$1,160.00');
    expect(formatCents(5)).toBe('$0.05');
    expect(rateLabel(1600)).toBe('IVA 16%');
    expect(rateLabel(null)).toBe('Exento');
  });

  it('starts on the first day of last month, also in January', () => {
    expect(defaultGlobalDay(new Date(2026, 10, 25))).toBe('2026-10-01');
    expect(defaultGlobalDay(new Date(2027, 0, 4))).toBe('2026-12-01');
  });

  it('explains a stale preview with both counts and a lost connection', () => {
    expect(
      globalFailureMessage({ ok: false, status: 409, detail: null, problem: { code: 'preview_stale', expectedSaleCount: 2, actualSaleCount: 3 } }),
    ).toContain('antes 2, ahora 3');
    expect(globalFailureMessage({ ok: false, status: 0, detail: null, problem: {} })).toContain('conexión');
  });

  it('lets only the owner and the manager open the invoicing screens', () => {
    expect(canAccess('/invoices/global', 'owner')).toBe(true);
    expect(canAccess('/invoices/global', 'manager')).toBe(true);
    expect(canAccess('/invoices/global', 'cashier')).toBe(false);
  });
});
