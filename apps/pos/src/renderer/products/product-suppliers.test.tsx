import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
    ...overrides,
  } as PurchasingApi;
}

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
