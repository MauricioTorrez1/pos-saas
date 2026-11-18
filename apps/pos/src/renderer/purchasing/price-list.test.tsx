import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { compareCatalogItems, milliText, type CatalogItem, type PriceListPreview, type SupplierCatalogApi } from '../../shared/supplier-catalog';
import type { OrderCandidate, PurchasingApi, Supplier } from '../../shared/supplier-order';
import { SupplierOrderDialog } from './SupplierOrderDialog';

const SUPPLIER: Supplier = { id: '019a5f2e-7c40-7b1a-9d2e-aaaaaaaaaaa1', name: 'Ferretera del Centro', contact: null, notes: null, isActive: true, revision: 1 };
const PRODUCT: OrderCandidate = {
  productId: '019a5f2e-7c40-7b1a-9d2e-bbbbbbbbbbb1',
  name: 'Cinta de aislar negra',
  unit: 'piece',
  barcode: null,
  stockMilli: 0,
  estimatedCostE6: null,
  supplierCodes: [],
  minimumMilli: null,
  maximumMilli: null,
  suggestedMilli: null,
  matchedBy: 'name',
};
const PREVIEW: PriceListPreview = {
  token: '019a5f2e-7c40-7b1a-9d2e-ccccccccccc1',
  fileName: 'lista.csv',
  headers: ['supplier_code', 'description', 'purchase_unit', 'pieces_per_unit', 'cost'],
  sampleRows: [['CA-34', 'Cinta de aislar', 'Caja', '10', '85.5']],
  rowCount: 1,
  mapping: { supplierCode: 'supplier_code', description: 'description', purchaseUnit: 'purchase_unit', piecesPerUnit: 'pieces_per_unit', cost: 'cost' },
  mappingOrigin: 'agreed',
  costsIncludeVat: false,
  source: 'paper',
};
const ITEM: CatalogItem = {
  id: '019a5f2e-7c40-7b1a-9d2e-ddddddddddd1',
  supplierId: SUPPLIER.id,
  supplierName: SUPPLIER.name,
  supplierCode: 'CA-34',
  description: 'Cinta de aislar',
  purchaseUnit: 'Caja',
  piecesPerUnitMilli: 10_000,
  listCostE6: 85_500_000,
  baseUnitCostE6: 8_550_000,
  productId: null,
  productName: null,
  productUnit: null,
  productBarcode: null,
  linkOrigin: null,
  listDate: '2026-11-17',
  source: 'paper',
};

const CHEAP: CatalogItem = { ...ITEM, productId: PRODUCT.productId, productName: PRODUCT.name, productUnit: 'piece', linkOrigin: 'manual' };
const DEAR: CatalogItem = { ...CHEAP, id: '019a5f2e-7c40-7b1a-9d2e-ddddddddddd2', supplierId: '019a5f2e-7c40-7b1a-9d2e-aaaaaaaaaaa2', supplierName: 'Eléctrica del Norte', supplierCode: 'N-1', baseUnitCostE6: 10_000_000 };

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
});

afterEach(cleanup);

function purchasing(): PurchasingApi {
  return {
    listSuppliers: vi.fn(() => Promise.resolve([SUPPLIER])),
    listOrders: vi.fn(() => Promise.resolve([])),
    searchOrderProducts: vi.fn(() => Promise.resolve([PRODUCT])),
  } as unknown as PurchasingApi;
}

function catalogApi(): SupplierCatalogApi {
  return {
    pickPriceList: vi.fn(() => Promise.resolve({ status: 'picked' as const, preview: PREVIEW })),
    importPriceList: vi.fn(() => Promise.resolve({ status: 'imported' as const, summary: { itemCount: 1, linkedCount: 0, skippedCount: 0, skipped: [] } })),
    priceListSummary: vi.fn(() => Promise.resolve({ supplierId: SUPPLIER.id, listDate: '2026-11-17', source: 'paper' as const, itemCount: 1, linkedCount: 0 })),
    listCatalogItems: vi.fn(() => Promise.resolve([ITEM])),
    linkCatalogItem: vi.fn(() => Promise.resolve({ status: 'linked' as const, item: { ...ITEM, productId: PRODUCT.productId, productName: PRODUCT.name, linkOrigin: 'manual' as const } })),
    compareItems: vi.fn(() => Promise.resolve(compareCatalogItems([CHEAP, DEAR]))),
    confirmCart: vi.fn(() => Promise.resolve({ status: 'created' as const, orders: [{ orderId: 'o', folio: 3, supplierName: 'Eléctrica del Norte', lineCount: 1, totalCents: 3_000 }] })),
    exportCartPdf: vi.fn(() => Promise.resolve({ status: 'saved' as const, path: 'C:/pedido.pdf' })),
  };
}

async function openSupplier(catalog: SupplierCatalogApi, isOwner: boolean): Promise<void> {
  render(<SupplierOrderDialog api={purchasing()} catalogApi={catalog} isOwner={isOwner} onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole('button', { name: /Proveedores/ }));
  fireEvent.click(await screen.findByRole('button', { name: SUPPLIER.name }));
}

describe('the price list of a supplier', () => {
  it('writes quantities in thousandths without decimal numbers', () => {
    expect(milliText(12_000)).toBe('12');
    expect(milliText(2_500)).toBe('2.5');
  });

  it('is not offered to a cashier', async () => {
    await openSupplier(catalogApi(), false);
    expect(screen.queryByRole('button', { name: /Lista de precios/ })).toBeNull();
  });

  it('imports a file with costs before VAT by default and links an item by hand', async () => {
    const catalog = catalogApi();
    await openSupplier(catalog, true);
    fireEvent.click(await screen.findByRole('button', { name: /Lista de precios/ }));
    await screen.findByText(/1 artículos, 0 ligados/);

    fireEvent.click(screen.getByRole('button', { name: /Importar lista/ }));
    await screen.findByText(/catálogo en papel: ya reconocí sus columnas/);
    expect((screen.getByLabelText('¿Los costos del archivo incluyen IVA?') as HTMLSelectElement).value).toBe('no');
    fireEvent.click(screen.getByRole('button', { name: /Reemplazar la lista/ }));
    await screen.findByText(/Entraron 1 artículos/);
    expect(catalog.importPriceList).toHaveBeenCalledWith(expect.objectContaining({ token: PREVIEW.token, supplierId: SUPPLIER.id, costsIncludeVat: false, source: 'paper', mapping: PREVIEW.mapping }));

    fireEvent.click(await screen.findByRole('button', { name: 'Ligar CA-34' }));
    fireEvent.click(screen.getByRole('button', { name: /Buscar/ }));
    fireEvent.click(await screen.findByRole('button', { name: PRODUCT.name }));
    await waitFor(() => expect(catalog.linkCatalogItem).toHaveBeenCalledWith({ itemId: ITEM.id, productId: PRODUCT.productId }));
    await screen.findByText(/la próxima lista lo recordará/);
  });
});

describe('the price comparator', () => {
  it('marks the cheapest and the most expensive, adds the cheapest, lets the owner switch supplier and creates the orders', async () => {
    const catalog = catalogApi();
    await openSupplier(catalog, true);
    fireEvent.click(await screen.findByRole('button', { name: /Comparar precios/ }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar en las listas' }), { target: { value: 'cinta de aislar' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Buscar en las listas' }), { key: 'Enter' });
    const cheapRow = (await screen.findByText('CA-34')).closest('tr')!;
    expect(cheapRow.className).toBe('price-cheapest');
    expect(cheapRow.textContent).toContain('El más barato');
    const dearRow = screen.getByText('N-1').closest('tr')!;
    expect(dearRow.className).toBe('price-highest');
    expect(dearRow.textContent).toContain('+$1.45 (+17 %)');

    fireEvent.click(screen.getByRole('button', { name: `Agregar ${PRODUCT.name}` }));
    const supplierBox = screen.getByRole('combobox', { name: `Proveedor de ${PRODUCT.name}` }) as HTMLSelectElement;
    expect(supplierBox.value).toBe(CHEAP.id);
    fireEvent.change(screen.getByRole('textbox', { name: `Cantidad de ${PRODUCT.name}` }), { target: { value: '3' } });
    fireEvent.change(supplierBox, { target: { value: DEAR.id } });
    expect(screen.getByRole('status', { name: 'Total del carrito' }).textContent).toContain('ahorro posible: $4.35');

    fireEvent.click(screen.getByRole('button', { name: /PDF del pedido/ }));
    await screen.findByText(/PDF guardado en C:\/pedido.pdf/);
    fireEvent.click(screen.getByRole('button', { name: /Crear pedidos/ }));
    await waitFor(() => expect(catalog.confirmCart).toHaveBeenCalledWith({ lines: [{ productId: PRODUCT.productId, quantityMilli: 3_000, itemId: DEAR.id }] }));
    await screen.findByText(/PED-0003 para Eléctrica del Norte/);
    expect(screen.queryByRole('table', { name: 'Productos del carrito' })).toBeNull();
  });

  it('is not offered to a cashier', async () => {
    await openSupplier(catalogApi(), false);
    expect(screen.queryByRole('button', { name: /Comparar precios/ })).toBeNull();
  });
});
