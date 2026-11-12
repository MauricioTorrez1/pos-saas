import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { OrderCandidate, PurchasingApi, Supplier } from '../../shared/supplier-order';
import { SupplierOrderDialog } from './SupplierOrderDialog';

const SUPPLIER: Supplier = { id: '019a5f2e-7c40-7b1a-9d2e-aaaaaaaaaaa1', name: 'Ferretera del Centro', contact: '55 1234 5678', notes: null, isActive: true, revision: 2 };
const TAPE: OrderCandidate = {
  productId: '019a5f2e-7c40-7b1a-9d2e-bbbbbbbbbbb1',
  name: 'Cinta métrica 5 m',
  unit: 'piece',
  barcode: '7501234567890',
  stockMilli: 2_000,
  estimatedCostE6: null,
  supplierCodes: [],
  minimumMilli: null,
  maximumMilli: null,
  suggestedMilli: null,
  matchedBy: 'name',
};

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
});

afterEach(cleanup);

function apiWith(overrides: Partial<PurchasingApi> = {}): PurchasingApi {
  return {
    listSuppliers: vi.fn(() => Promise.resolve([SUPPLIER])),
    saveSupplier: vi.fn(() => Promise.resolve({ status: 'saved' as const, supplier: { ...SUPPLIER, revision: 3 } })),
    getSupplierLinks: vi.fn(() => Promise.resolve([{ supplierId: SUPPLIER.id, supplierName: SUPPLIER.name, productId: TAPE.productId, codes: [{ supplierCode: 'CM-5', listCostE6: 50_500_000, purchaseUnit: 'Caja con 12' }] }])),
    setSupplierCodes: vi.fn(() => Promise.resolve({ status: 'saved' as const, links: [] })),
    searchOrderProducts: vi.fn(() => Promise.resolve([TAPE])),
    suggestOrderProducts: vi.fn(() => Promise.resolve([])),
    setReorderLevel: vi.fn(),
    listOrders: vi.fn(() => Promise.resolve([])),
    getOrder: vi.fn(() => Promise.resolve(null)),
    saveOrder: vi.fn(),
    markOrderSent: vi.fn(),
    discardOrder: vi.fn(),
    exportOrder: vi.fn(),
    revealFile: vi.fn(() => Promise.resolve()),
    ...overrides,
  } as PurchasingApi;
}

function press(key: string): void {
  fireEvent.keyDown(document.body, { key });
}

async function openSuppliers(api: PurchasingApi, isOwner = true): Promise<void> {
  render(<SupplierOrderDialog api={api} isOwner={isOwner} onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Proveedores/ }));
  await screen.findByRole('heading', { name: 'Proveedores' });
}

function box(label: string): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('textbox', { name: label });
}

describe('the suppliers (E1-44)', () => {
  it('adds a supplier with its contact and notes as optional texts', async () => {
    const api = apiWith({ listSuppliers: vi.fn(() => Promise.resolve([])) });
    await openSuppliers(api);
    expect(await screen.findByText(/Todavía no hay proveedores/)).toBeTruthy();

    fireEvent.change(box('Nombre del proveedor'), { target: { value: 'Pinturas Rápidas' } });
    fireEvent.change(box('Contacto (opcional)'), { target: { value: '  ' } });
    press('F2');

    await waitFor(() => expect(api.saveSupplier).toHaveBeenCalledWith({ name: 'Pinturas Rápidas', contact: null, notes: null, isActive: true }));
    expect(await screen.findByText('Listo. El proveedor quedó guardado con tu nombre.')).toBeTruthy();
  });

  it('does not save a supplier without a name', async () => {
    const api = apiWith();
    await openSuppliers(api);

    press('F2');

    expect(await screen.findByText('Escribe el nombre del proveedor.')).toBeTruthy();
    expect(api.saveSupplier).not.toHaveBeenCalled();
  });

  it('edits a supplier with the revision it loaded, and can give it up', async () => {
    const api = apiWith();
    await openSuppliers(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Ferretera del Centro' }));
    expect(box('Contacto (opcional)').value).toBe('55 1234 5678');

    fireEvent.click(screen.getByRole('checkbox', { name: /Activo/ }));
    press('F2');

    await waitFor(() =>
      expect(api.saveSupplier).toHaveBeenCalledWith({ supplierId: SUPPLIER.id, expectedRevision: 2, name: 'Ferretera del Centro', contact: '55 1234 5678', notes: null, isActive: false }),
    );
  });

  it('says when the name is taken, and when the supplier changed meanwhile', async () => {
    const api = apiWith({
      saveSupplier: vi
        .fn()
        .mockResolvedValueOnce({ status: 'duplicate_name', supplierId: 'x', name: 'Pinturas Rápidas' })
        .mockResolvedValueOnce({ status: 'stale', supplier: { ...SUPPLIER, name: 'Nombre nuevo', revision: 5 } }),
    });
    await openSuppliers(api);
    fireEvent.change(box('Nombre del proveedor'), { target: { value: 'pinturas rápidas' } });

    press('F2');
    expect(await screen.findByText('Ya hay un proveedor que se llama «Pinturas Rápidas».')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: 'Ferretera del Centro' }));
    press('F2');
    expect(await screen.findByText(/Este proveedor cambió mientras lo editabas/)).toBeTruthy();
    expect(box('Nombre del proveedor').value).toBe('Nombre nuevo');
  });

  it('needs the PIN of an owner from a cashier', async () => {
    const api = apiWith();
    await openSuppliers(api, false);
    fireEvent.change(box('Nombre del proveedor'), { target: { value: 'Pinturas Rápidas' } });

    press('F2');
    expect(await screen.findByText('Pídele al dueño que escriba su PIN.')).toBeTruthy();
    expect(api.saveSupplier).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('PIN del dueño'), { target: { value: '4321' } });
    press('F2');
    await waitFor(() => expect(api.saveSupplier).toHaveBeenCalledWith(expect.objectContaining({ ownerPin: '4321' })));
  });
});

describe('the codes of a supplier (E1-44)', () => {
  async function openCodes(api: PurchasingApi): Promise<void> {
    await openSuppliers(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Ferretera del Centro' }));
    press('F4');
    await screen.findByRole('heading', { name: 'Códigos de Ferretera del Centro' });
    fireEvent.change(box('Producto'), { target: { value: 'cinta' } });
    fireEvent.keyDown(box('Producto'), { key: 'Enter' });
    await screen.findByRole('heading', { name: 'Cinta métrica 5 m' });
  }

  it('shows the codes the supplier already has for the product, with the list cost and the presentation', async () => {
    await openCodes(apiWith());

    expect(box('Código o SKU del proveedor 1').value).toBe('CM-5');
    expect(box('Costo de lista 1 (opcional)').value).toBe('50.50');
    expect(box('Presentación 1 (opcional)').value).toBe('Caja con 12');
    expect(screen.getByText(/Código de barras propio: 7501234567890/)).toBeTruthy();
  });

  it('saves several codes for one product as whole numbers, and refuses a repeated or empty one', async () => {
    const api = apiWith();
    await openCodes(api);

    fireEvent.click(screen.getByRole('button', { name: 'Agregar un código' }));
    press('F2');
    expect(await screen.findByText('Cada renglón necesita su código. Quita los que estén vacíos.')).toBeTruthy();

    fireEvent.change(box('Código o SKU del proveedor 2'), { target: { value: 'cm-5' } });
    press('F2');
    expect(await screen.findByText('Hay un código repetido en la lista.')).toBeTruthy();
    expect(api.setSupplierCodes).not.toHaveBeenCalled();

    fireEvent.change(box('Código o SKU del proveedor 2'), { target: { value: '000123' } });
    fireEvent.change(box('Costo de lista 2 (opcional)'), { target: { value: '1.5' } });
    press('F2');

    await waitFor(() =>
      expect(api.setSupplierCodes).toHaveBeenCalledWith({
        supplierId: SUPPLIER.id,
        productId: TAPE.productId,
        codes: [
          { supplierCode: 'CM-5', listCostE6: 50_500_000, purchaseUnit: 'Caja con 12' },
          { supplierCode: '000123', listCostE6: 1_500_000, purchaseUnit: null },
        ],
      }),
    );
    expect(await screen.findByText('Listo. Los códigos quedaron guardados con tu nombre.')).toBeTruthy();
  });

  it('removes a code and saves the shorter list, which is how a product loses its codes', async () => {
    const api = apiWith();
    await openCodes(api);

    fireEvent.click(screen.getByRole('button', { name: 'Quitar código 1' }));
    press('F2');

    await waitFor(() => expect(api.setSupplierCodes).toHaveBeenCalledWith({ supplierId: SUPPLIER.id, productId: TAPE.productId, codes: [] }));
  });
});
