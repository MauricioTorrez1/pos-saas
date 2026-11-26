// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_GLOBAL_STATE, type GlobalInvoiceState, type GlobalPreview, type GlobalSummary } from '@/lib/invoicing/types';
import { GlobalInvoiceList } from './global-invoice-list';
import { GlobalInvoicePanel } from './global-invoice-panel';

afterEach(cleanup);

const PREVIEW: GlobalPreview = {
  periodicity: 'monthly',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  closed: true,
  deadline: '2026-11-03',
  saleCount: 2,
  totalCents: 16600,
  byRate: [
    { taxRateBasisPoints: 1600, baseCents: 10000, taxCents: 1600, totalCents: 11600 },
    { taxRateBasisPoints: null, baseCents: 5000, taxCents: 0, totalCents: 5000 },
  ],
  paymentForm: '01',
  individuallyInvoiced: 1,
  existing: null,
  sales: [
    { saleId: 'a', folio: 101, day: '2026-10-03', totalCents: 11600 },
    { saleId: 'b', folio: 102, day: '2026-10-20', totalCents: 5000 },
  ],
};

const STAMPED: GlobalSummary = {
  id: 'g1',
  periodicity: 'monthly',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  status: 'stamped',
  saleCount: 2,
  expectedTotalCents: 16600,
  totalCents: 16600,
  fiscalUuid: '11111111-2222-3333-4444-555555555555',
  providerInvoiceId: 'inv_1',
  errorCode: null,
  overlappingInvoices: 0,
  cancellationStatus: null,
  cancellationMotive: null,
};

function withPreview(overrides: Partial<GlobalPreview> = {}): GlobalInvoiceState {
  return { ...EMPTY_GLOBAL_STATE, preview: { request: { periodicity: 'monthly', day: '2026-10-01' }, result: { ...PREVIEW, ...overrides } } };
}

describe('GlobalInvoicePanel', () => {
  it('asks for a preview with the period, shows the totals per rate and stamps with a second click', async () => {
    const action = vi
      .fn<(previous: GlobalInvoiceState, data: FormData) => Promise<GlobalInvoiceState>>()
      .mockResolvedValueOnce(withPreview())
      .mockResolvedValueOnce({ ...EMPTY_GLOBAL_STATE, issued: STAMPED });
    render(<GlobalInvoicePanel action={action} defaultDay="2026-10-01" />);

    fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }));

    await screen.findByText(/2 ventas sin factura/);
    const sent = action.mock.calls[0]![1];
    expect(sent.get('intent')).toBe('preview');
    expect(sent.get('periodicity')).toBe('monthly');
    expect(sent.get('day')).toBe('2026-10-01');
    expect(screen.getByRole('table', { name: 'Totales por tasa' }).textContent).toContain('IVA 16%');
    expect(screen.getByText('Exento')).toBeTruthy();
    expect(screen.getByText(/Se dejan fuera 1 con factura propia/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Timbrar factura global de 2 ventas' }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('11111111-2222-3333-4444-555555555555'));
    expect(action.mock.calls[1]![1].get('intent')).toBe('issue');
  });

  it('does not offer to stamp an open period or one that already has its global', async () => {
    const action = vi
      .fn<(previous: GlobalInvoiceState, data: FormData) => Promise<GlobalInvoiceState>>()
      .mockResolvedValueOnce(withPreview({ closed: false }))
      .mockResolvedValueOnce(withPreview({ existing: STAMPED }));
    render(<GlobalInvoicePanel action={action} defaultDay="2026-11-01" />);

    fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }));
    await screen.findByText(/todavía no termina/);
    expect(screen.queryByRole('button', { name: /Timbrar/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }));
    await screen.findByText(/ya tiene su factura global/);
    expect(screen.queryByRole('button', { name: /Timbrar/ })).toBeNull();
  });

  it('shows the error of the core and the words of the provider', async () => {
    const action = vi.fn().mockResolvedValue({
      ...withPreview(),
      error: 'Facturapi rechazó la factura global.',
      providerMessage: 'El código postal no existe',
    });
    render(<GlobalInvoicePanel action={action} defaultDay="2026-10-01" />);

    fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Facturapi rechazó');
    expect(alert.textContent).toContain('El código postal no existe');
  });
});

describe('GlobalInvoiceList', () => {
  it('flags a global whose sales were invoiced on their own', () => {
    render(<GlobalInvoiceList globals={[{ ...STAMPED, overlappingInvoices: 1 }]} />);

    expect(screen.getByText(/Por corregir: 1 venta se facturó aparte/)).toBeTruthy();
    expect(screen.getByText(/motivo 04/)).toBeTruthy();
  });

  it('says when there is none yet', () => {
    render(<GlobalInvoiceList globals={[]} />);

    expect(screen.getByText('Todavía no hay facturas globales.')).toBeTruthy();
  });
});
