import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CatalogExportApi } from '../../shared/catalog-export';
import { CatalogExportView } from './CatalogExportView';

afterEach(cleanup);

describe('CatalogExportView', () => {
  it('exports the active products by default, in the format of each key, and says where the file went', async () => {
    const exportCatalog = vi.fn<CatalogExportApi['exportCatalog']>(() => Promise.resolve({ status: 'saved', path: 'C:\\catalogo.xlsx', productCount: 1234 }));
    render(<CatalogExportView catalogExportApi={{ exportCatalog }} onBack={() => undefined} />);
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Solo activos (F5)' }).checked).toBe(true);

    fireEvent.keyDown(window, { key: 'F3' });
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('1234 producto(s) en Excel (.xlsx), guardado en C:\\catalogo.xlsx'));
    expect(exportCatalog).toHaveBeenCalledWith({ format: 'xlsx', activeOnly: true });
  });

  it('includes the products that were given up when the filter is turned off', async () => {
    const exportCatalog = vi.fn<CatalogExportApi['exportCatalog']>(() => Promise.resolve({ status: 'cancelled' }));
    render(<CatalogExportView catalogExportApi={{ exportCatalog }} onBack={() => undefined} />);
    fireEvent.keyDown(window, { key: 'F5' });
    expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Solo activos (F5)' }).checked).toBe(false);
    fireEvent.keyDown(window, { key: 'F4' });
    await waitFor(() => expect(exportCatalog).toHaveBeenCalledWith({ format: 'csv', activeOnly: false }));
    fireEvent.keyDown(window, { key: 'F2' });
    await waitFor(() => expect(exportCatalog).toHaveBeenLastCalledWith({ format: 'pdf', activeOnly: false }));
  });

  it('says in words that only the owner exports the catalog', async () => {
    const exportCatalog = vi.fn<CatalogExportApi['exportCatalog']>(() => Promise.resolve({ status: 'authorization_required' }));
    render(<CatalogExportView catalogExportApi={{ exportCatalog }} onBack={() => undefined} />);
    fireEvent.keyDown(window, { key: 'F4' });
    expect((await screen.findByRole('alert')).textContent).toBe('Solo el dueño puede exportar el catálogo.');
  });

  it('goes back with Esc', () => {
    const onBack = vi.fn();
    render(<CatalogExportView catalogExportApi={{ exportCatalog: () => Promise.resolve({ status: 'cancelled' }) }} onBack={onBack} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onBack).toHaveBeenCalledOnce();
  });
});
