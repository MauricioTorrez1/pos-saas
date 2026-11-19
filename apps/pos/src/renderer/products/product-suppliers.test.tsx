import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { PurchaseOrder, PurchasingApi, Supplier, SupplierProductLink } from '../../shared/supplier-order';
import { ProductSuppliers } from './ProductSuppliers';

const PRODUCT_ID = '0190f0d0-0000-7000-8000-000000000010';

function supplierNamed(index: number): Supplier {
  return { id: `0190f0d0-0000-7000-8000-00000000010${String(index)}`, name: `Proveedor ${String(index)}`, contact: null, notes: null, isActive: true, revision: 1 };
}

const SUPPLIERS = [1, 2, 3, 4, 5].map(supplierNamed);
const LINKS: SupplierProductLink[] = SUPPLIERS.slice(0, 4).map((supplier, index) => ({
  supplierId: supplier.id,
  supplierName: supplier.name,
  productId: PRODUCT_ID,
  codes: [{ supplierCode: `CIN-${String(index)}`, listCostE6: 12_500_000, purchaseUnit: null }],
}));

const ORDER: PurchaseOrder = {
  id: '0190f0d0-0000-7000-8000-000000000200',
  folio: 7,
  supplierId: SUPPLIERS[2]!.id,
  supplierName: 'Proveedor 3',
  status: 'draft',
  notes: null,
  createdAt: '2026-11-17T18:00:00.000Z',
  updatedAt: '2026-11-17T18:00:00.000Z',
  sentAt: null,
  revision: 1,
  lines: [],
  totalCents: 0,
  linesWithoutCost: 0,
};

function apiWith(overrides: Partial<PurchasingApi> = {}): PurchasingApi {
  return {
    getSupplierLinks: () => Promise.resolve(LINKS),
    listSuppliers: () => Promise.resolve(SUPPLIERS),
    orderMore: () => Promise.resolve({ status: 'added', order: ORDER, quantityMilli: 6000 }),
    setSupplierCodes: () => Promise.resolve({ status: 'saved', links: LINKS }),
    changeSupplierLink: () => Promise.resolve({ status: 'saved', links: LINKS }),
    findDraftsWithProduct: () => Promise.resolve([]),
    unlinkSupplier: () => Promise.resolve({ status: 'removed', links: LINKS.slice(1), draftsChanged: 0 }),
    ...overrides,
  } as PurchasingApi;
}

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
});

afterEach(cleanup);

describe('the suppliers of a product (E1-50)', () => {
  it('lists every supplier, more than three, each with a green «Pedir más» that adds it to its order', async () => {
    const orderMore = vi.fn<PurchasingApi['orderMore']>(() => Promise.resolve({ status: 'added', order: ORDER, quantityMilli: 6000 }));
    render(<ProductSuppliers api={apiWith({ orderMore })} productId={PRODUCT_ID} unit="piece" barcode="7501234567890" isOwner ownerPin="" />);

    const buttons = await screen.findAllByRole('button', { name: 'Pedir más' });
    expect(buttons).toHaveLength(4);
    expect(buttons[2]?.className).toContain('button-good');
    fireEvent.click(buttons[2]!);

    await waitFor(() => expect(orderMore).toHaveBeenCalledExactlyOnceWith({ productId: PRODUCT_ID, supplierId: SUPPLIERS[2]!.id }));
    expect(await screen.findByText(/Agregado al pedido PED-0007 de Proveedor 3: 6 pza/)).toBeDefined();
  });

  it('links one more supplier with the barcode as its code and a list cost', async () => {
    const setSupplierCodes = vi.fn<PurchasingApi['setSupplierCodes']>(() => Promise.resolve({ status: 'saved', links: LINKS }));
    render(<ProductSuppliers api={apiWith({ setSupplierCodes })} productId={PRODUCT_ID} unit="piece" barcode="7501234567890" isOwner={false} ownerPin="4321" />);
    await screen.findAllByRole('button', { name: 'Pedir más' });

    fireEvent.change(screen.getByLabelText('Costo de lista (opcional)'), { target: { value: '11.9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar proveedor' }));

    await waitFor(() =>
      expect(setSupplierCodes).toHaveBeenCalledExactlyOnceWith({
        supplierId: SUPPLIERS[4]!.id,
        productId: PRODUCT_ID,
        codes: [{ supplierCode: '7501234567890', listCostE6: 11_900_000, purchaseUnit: null }],
        ownerPin: '4321',
      }),
    );
  });

  it('says where the product already is when it was ordered before', async () => {
    render(<ProductSuppliers api={apiWith({ orderMore: () => Promise.resolve({ status: 'already_in_order', order: ORDER }) })} productId={PRODUCT_ID} unit="piece" barcode={null} isOwner ownerPin="" />);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Pedir más' }))[0]!);

    expect(await screen.findByText(/Ya está en el pedido PED-0007 de Proveedor 3/)).toBeDefined();
  });
});

describe('changing and removing a supplier of a product (E1-58)', () => {
  it('shows a yellow «Modificar» and a red «Eliminar» next to every green «Pedir más»', async () => {
    render(<ProductSuppliers api={apiWith()} productId={PRODUCT_ID} unit="piece" barcode={null} isOwner ownerPin="" />);
    await screen.findAllByRole('button', { name: 'Pedir más' });

    expect(screen.getAllByRole('button', { name: /^Modificar / }).map((button) => button.className)).toEqual(Array(4).fill('button button-warning'));
    expect(screen.getAllByRole('button', { name: /^Eliminar / }).map((button) => button.className)).toEqual(Array(4).fill('button button-danger'));
  });

  it('turns the row into a form that moves the code and the cost to another supplier, with the PIN of a cashier', async () => {
    const changeSupplierLink = vi.fn<PurchasingApi['changeSupplierLink']>(() => Promise.resolve({ status: 'saved', links: LINKS }));
    render(<ProductSuppliers api={apiWith({ changeSupplierLink })} productId={PRODUCT_ID} unit="piece" barcode={null} isOwner={false} ownerPin="4321" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Modificar Proveedor 2' }));

    // Only the current supplier and the ones that do not sell it yet are offered.
    const select = screen.getByLabelText('Proveedor') as HTMLSelectElement;
    expect([...select.options].map((option) => option.text)).toEqual(['Proveedor 2', 'Proveedor 5']);
    expect((screen.getByLabelText('Costo de lista 1 (opcional)') as HTMLInputElement).value).toBe('12.50');
    expect(screen.queryByRole('button', { name: 'Agregar proveedor' })).toBeNull();

    fireEvent.change(select, { target: { value: SUPPLIERS[4]!.id } });
    fireEvent.change(screen.getByLabelText('Código del proveedor 1'), { target: { value: 'P5-77' } });
    fireEvent.change(screen.getByLabelText('Costo de lista 1 (opcional)'), { target: { value: '13' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() =>
      expect(changeSupplierLink).toHaveBeenCalledExactlyOnceWith({
        productId: PRODUCT_ID,
        fromSupplierId: SUPPLIERS[1]!.id,
        toSupplierId: SUPPLIERS[4]!.id,
        codes: [{ supplierCode: 'P5-77', listCostE6: 13_000_000, purchaseUnit: null }],
        ownerPin: '4321',
      }),
    );
    expect(await screen.findByText('Proveedor del producto actualizado.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Guardar cambios' })).toBeNull();
  });

  it('says what to fix in the form and sends nothing, and Cancelar leaves the row as it was', async () => {
    const changeSupplierLink = vi.fn<PurchasingApi['changeSupplierLink']>();
    render(<ProductSuppliers api={apiWith({ changeSupplierLink })} productId={PRODUCT_ID} unit="piece" barcode={null} isOwner ownerPin="" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Modificar Proveedor 1' }));

    fireEvent.change(screen.getByLabelText('Código del proveedor 1'), { target: { value: ' ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByText('Escribe el código con el que el proveedor lo vende.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));

    expect(changeSupplierLink).not.toHaveBeenCalled();
    expect(screen.getByText('CIN-0 · $12.50')).toBeDefined();
  });

  it('asks before removing, and removes the supplier when the owner says yes', async () => {
    const unlinkSupplier = vi.fn<PurchasingApi['unlinkSupplier']>(() => Promise.resolve({ status: 'removed', links: LINKS.slice(1), draftsChanged: 0 }));
    render(<ProductSuppliers api={apiWith({ unlinkSupplier })} productId={PRODUCT_ID} unit="piece" barcode={null} isOwner ownerPin="" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar Proveedor 1' }));

    expect(await screen.findByRole('heading', { name: '¿Quitar a Proveedor 1 de este producto?' })).toBeDefined();
    expect(screen.queryByLabelText('Quitarlo también del borrador')).toBeNull();
    const confirm = screen.getByRole('button', { name: /Sí, quitar proveedor/ });
    expect(confirm.className).toContain('button-danger');
    fireEvent.click(confirm);

    await waitFor(() => expect(unlinkSupplier).toHaveBeenCalledExactlyOnceWith({ supplierId: SUPPLIERS[0]!.id, productId: PRODUCT_ID, removeFromDrafts: false }));
    expect(await screen.findByText('Proveedor 1 quitado del producto.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Eliminar Proveedor 1' })).toBeNull();
  });

  it('tells the owner the product is on a draft of that supplier and keeps it there unless asked', async () => {
    const unlinkSupplier = vi.fn<PurchasingApi['unlinkSupplier']>(() => Promise.resolve({ status: 'removed', links: [], draftsChanged: 1 }));
    const findDraftsWithProduct = vi.fn<PurchasingApi['findDraftsWithProduct']>(() => Promise.resolve([{ orderId: ORDER.id, folio: 7 }]));
    render(<ProductSuppliers api={apiWith({ unlinkSupplier, findDraftsWithProduct })} productId={PRODUCT_ID} unit="piece" barcode={null} isOwner ownerPin="" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar Proveedor 3' }));

    expect(await screen.findByText(/Está en el borrador PED-0007 de Proveedor 3/)).toBeDefined();
    const keep = screen.getByLabelText('Quitarlo también del borrador') as HTMLInputElement;
    expect(keep.checked).toBe(false);
    fireEvent.click(keep);
    fireEvent.click(screen.getByRole('button', { name: /Sí, quitar proveedor/ }));

    await waitFor(() => expect(unlinkSupplier).toHaveBeenCalledExactlyOnceWith({ supplierId: SUPPLIERS[2]!.id, productId: PRODUCT_ID, removeFromDrafts: true }));
    expect(await screen.findByText('Proveedor 3 quitado del producto y de su borrador.')).toBeDefined();
  });

  it('says the owner has to approve when a cashier removes a supplier without the PIN', async () => {
    render(<ProductSuppliers api={apiWith({ unlinkSupplier: () => Promise.resolve({ status: 'authorization_required' }) })} productId={PRODUCT_ID} unit="piece" barcode={null} isOwner={false} ownerPin="" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar Proveedor 1' }));
    fireEvent.click(await screen.findByRole('button', { name: /Sí, quitar proveedor/ }));

    expect(await screen.findByText('Pídele al dueño que escriba su PIN en el panel.')).toBeDefined();
  });
});
