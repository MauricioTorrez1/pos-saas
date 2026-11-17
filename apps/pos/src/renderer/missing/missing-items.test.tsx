import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { MissingItemsApi, MissingItemsReport } from '../../shared/missing-items';
import { MissingItemsDialog } from './MissingItemsDialog';

const REPORT: MissingItemsReport = {
  period: 30,
  groups: [
    { key: 'taquete de 1/4', description: 'Taquete de 1/4', timesAsked: 5, quantityAsked: 120, notes: ['Fischer'], firstAskedAt: '2026-11-01T18:00:00.000Z', lastAskedAt: '2026-11-17T18:00:00.000Z', status: 'pending' },
    { key: 'lija 100', description: 'Lija 100', timesAsked: 2, quantityAsked: 0, notes: [], firstAskedAt: '2026-11-10T18:00:00.000Z', lastAskedAt: '2026-11-12T18:00:00.000Z', status: 'added' },
  ],
  byWeek: [
    { key: '2026-11-09', count: 3 },
    { key: '2026-11-16', count: 4 },
  ],
  byWeekday: ['0', '1', '2', '3', '4', '5', '6'].map((key) => ({ key, count: key === '3' ? 7 : 0 })),
  totalRequests: 7,
  generatedAt: '2026-11-18T18:00:00.000Z',
};

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
});

afterEach(cleanup);

function apiWith(overrides: Partial<MissingItemsApi> = {}): MissingItemsApi {
  return {
    record: () => Promise.resolve({ status: 'recorded', timesAsked: 6 }),
    report: () => Promise.resolve(REPORT),
    resolve: () => Promise.resolve(),
    exportPdf: () => Promise.resolve({ status: 'saved', path: 'C:\\faltantes.pdf' }),
    ...overrides,
  };
}

describe('MissingItemsDialog', () => {
  it('writes down what was looked for with Enter and says how many times it was asked', async () => {
    const record = vi.fn<MissingItemsApi['record']>(() => Promise.resolve({ status: 'recorded', timesAsked: 6 }));
    render(<MissingItemsDialog api={apiWith({ record })} isOwner={false} initialDescription="Taquete de 1/4" onClose={() => undefined} />);
    const description = screen.getByLabelText<HTMLInputElement>('¿Qué pidió el cliente?');
    expect(description.value).toBe('Taquete de 1/4');

    fireEvent.change(screen.getByLabelText('Cantidad que quería (opcional)'), { target: { value: '2x0' } });
    fireEvent.keyDown(description, { key: 'Enter' });

    await waitFor(() => expect(record).toHaveBeenCalledExactlyOnceWith({ description: 'Taquete de 1/4', quantity: 20, notes: null }));
    expect(await screen.findByText('Anotado: «Taquete de 1/4». Ya lo han pedido 6 veces.')).toBeDefined();
    expect(description.value).toBe('');
  });

  it('shows the most asked first with the totals and the charts, and lets only the owner decide', async () => {
    const { unmount } = render(<MissingItemsDialog api={apiWith()} isOwner={false} onClose={() => undefined} />);
    const list = await screen.findByRole('list', { name: 'Faltantes, lo más pedido primero', hidden: true });

    expect(list.textContent).toContain('Taquete de 1/4');
    expect(list.textContent).toContain('5 veces · querían 120 · Fischer');
    expect(screen.getByText('Veces por semana')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Ya lo vendemos', hidden: true })).toBeNull();
    unmount();

    const resolve = vi.fn<MissingItemsApi['resolve']>(() => Promise.resolve());
    render(<MissingItemsDialog api={apiWith({ resolve })} isOwner onClose={() => undefined} />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Ya lo vendemos', hidden: true }))[0]!);

    await waitFor(() => expect(resolve).toHaveBeenCalledExactlyOnceWith({ key: 'taquete de 1/4', status: 'added' }));
  });

  it('reads another period and saves the PDF of it', async () => {
    const report = vi.fn<MissingItemsApi['report']>(() => Promise.resolve(REPORT));
    const exportPdf = vi.fn<MissingItemsApi['exportPdf']>(() => Promise.resolve({ status: 'saved', path: 'C:\\faltantes.pdf' }));
    render(<MissingItemsDialog api={apiWith({ report, exportPdf })} isOwner onClose={() => undefined} />);
    await screen.findByRole('list', { name: 'Faltantes, lo más pedido primero', hidden: true });

    fireEvent.change(screen.getByLabelText('Periodo'), { target: { value: '365' } });
    await waitFor(() => expect(report).toHaveBeenLastCalledWith(365));
    fireEvent.click(screen.getByRole('button', { name: 'Descargar PDF con gráficas', hidden: true }));

    await waitFor(() => expect(exportPdf).toHaveBeenCalledExactlyOnceWith(365));
    expect(await screen.findByText('PDF guardado en C:\\faltantes.pdf')).toBeDefined();
  });
});
