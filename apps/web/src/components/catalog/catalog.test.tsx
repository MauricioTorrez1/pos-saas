// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PRICE_CHANGE, type PriceChangeState, type ProductFormState } from '@/lib/catalog/action-state';
import { productFormFromProduct } from '@/lib/catalog/product-form';
import type { ImportReport, Product } from '@/lib/catalog/types';
import { ImportReportView } from './import-report';
import { Pagination } from './pagination';
import { PriceChangePanel } from './price-change-panel';
import { PricePreview } from './price-preview';
import { ProductForm } from './product-form';
import { ProductTable } from './product-table';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(cleanup);

const PRODUCT: Product = {
  id: '0192f3a4-7b1c-7e2d-8a3f-5c9d1e2b4a61',
  name: 'Cable THW calibre 12',
  status: 'active',
  unit: 'meter',
  unitKind: 'length',
  codes: [
    { code: '7501000000012', kind: 'barcode' },
    { code: 'CAB12', kind: 'alternate' },
  ],
  presentations: [{ name: 'Rollo', baseQuantity: '100.000' }],
  unitPrice: '12.3450',
  taxFactor: 'rate',
  taxRateBp: 1600,
  satProductKey: null,
  satUnitKey: null,
  invoiceable: false,
  createdAt: '2026-11-17T00:00:00Z',
  updatedAt: '2026-11-17T00:00:00Z',
};

describe('ProductTable', () => {
  it('links each product to its edit page and shows the exact price', () => {
    render(<ProductTable products={[PRODUCT]} />);

    expect(screen.getByRole('link', { name: 'Cable THW calibre 12' }).getAttribute('href')).toBe(`/catalog/${PRODUCT.id}`);
    expect(screen.getByText('$12.345')).toBeTruthy();
    expect(screen.getByText('Metro')).toBeTruthy();
    expect(screen.getByText('Sin claves SAT')).toBeTruthy();
    expect(screen.getByText('+1')).toBeTruthy();
  });
});

describe('Pagination', () => {
  it('keeps the search in the links and counts pages from 1', () => {
    render(<Pagination page={1} pageSize={50} total={5000} query="cable" />);

    expect(screen.getByTestId('page-summary').textContent).toBe('51–100 de 5,000 productos');
    expect(screen.getByText('Página 2 de 100')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Siguiente' }).getAttribute('href')).toBe('/catalog?q=cable&page=3');
    expect(screen.getByRole('link', { name: 'Anterior' }).getAttribute('href')).toBe('/catalog?q=cable');
  });

  it('has no next link on the last page', () => {
    render(<Pagination page={0} pageSize={50} total={3} query="" />);

    expect(screen.queryByRole('link', { name: 'Siguiente' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Anterior' })).toBeNull();
  });
});

describe('ProductForm', () => {
  const idle = async (): Promise<ProductFormState> => ({ errors: {}, message: null });

  it('shows the price field only when asked', () => {
    const { rerender } = render(
      <ProductForm action={idle} initial={productFormFromProduct(null)} mode="create" showPrice={false} />,
    );
    expect(screen.queryByLabelText('Precio de venta con IVA')).toBeNull();

    rerender(<ProductForm action={idle} initial={productFormFromProduct(null)} mode="create" showPrice />);
    expect(screen.getByLabelText('Precio de venta con IVA')).toBeTruthy();
  });

  it('fills the edit form with the product, codes split by kind', () => {
    render(<ProductForm action={idle} initial={productFormFromProduct(PRODUCT)} mode="edit" showPrice={false} />);

    expect((screen.getByLabelText('Nombre') as HTMLInputElement).value).toBe('Cable THW calibre 12');
    expect((screen.getByLabelText('Códigos de barras') as HTMLTextAreaElement).value).toBe('7501000000012');
    expect((screen.getByLabelText('Claves propias de la tienda') as HTMLTextAreaElement).value).toBe('CAB12');
    expect((screen.getByLabelText('Unidades de la presentación 1') as HTMLInputElement).value).toBe('100.000');
    expect(screen.getByLabelText('Estado')).toBeTruthy();
  });

  it('shows the errors of the action next to the fields and keeps what was typed', async () => {
    const action = vi.fn(async (): Promise<ProductFormState> => ({
      errors: { name: 'Escribe el nombre del producto.' },
      message: null,
    }));
    render(<ProductForm action={action} initial={productFormFromProduct(null)} mode="create" showPrice />);
    fireEvent.change(screen.getByLabelText('Precio de venta con IVA'), { target: { value: '99.90' } });

    fireEvent.click(screen.getByRole('button', { name: 'Crear producto' }));

    expect(await screen.findByText('Escribe el nombre del producto.')).toBeTruthy();
    expect(screen.getByLabelText('Nombre').getAttribute('aria-invalid')).toBe('true');
    expect((screen.getByLabelText('Precio de venta con IVA') as HTMLInputElement).value).toBe('99.90');
  });

  it('adds and removes presentation rows', () => {
    render(<ProductForm action={idle} initial={productFormFromProduct(null)} mode="create" showPrice={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Agregar presentación' }));
    fireEvent.click(screen.getByRole('button', { name: 'Agregar presentación' }));
    expect(screen.getAllByRole('button', { name: 'Quitar' })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole('button', { name: 'Quitar' })[0]!);
    expect(screen.getAllByRole('button', { name: 'Quitar' })).toHaveLength(1);
  });
});

describe('ImportReportView', () => {
  const report: ImportReport = {
    rowsRead: 4,
    created: 2,
    alreadyThere: 1,
    pricesSkipped: 2,
    invalid: [{ line: 4, reason: 'El precio de venta debe ser mayor que cero.' }],
    ignoredColumns: ['Existencia'],
    dryRun: true,
  };

  it('summarizes a check and lists the rows that cannot be loaded', () => {
    render(<ImportReportView report={report} />);

    expect(screen.getByText('Revisión del archivo')).toBeTruthy();
    expect(screen.getByTestId('import-created').textContent).toBe('2');
    expect(screen.getByText('El precio de venta debe ser mayor que cero.')).toBeTruthy();
    expect(screen.getByText(/solo el dueño pone precios/)).toBeTruthy();
    expect(screen.getByText(/Existencia/)).toBeTruthy();
  });
});

describe('PricePreview', () => {
  it('says how many products change and that only the first ones are listed', () => {
    render(
      <PricePreview
        result={{
          applied: false,
          count: 501,
          lines: [{ productId: 'p1', name: 'Pala Truper', currentPrice: '100.0000', newPrice: '105.0000' }],
        }}
      />,
    );

    expect(screen.getByTestId('preview-count').textContent).toBe('501 productos cambian');
    expect(screen.getByText('$105.00')).toBeTruthy();
    expect(screen.getByText(/Se muestran los primeros 1/)).toBeTruthy();
  });

  it('explains an empty preview', () => {
    render(<PricePreview result={{ applied: false, count: 0, lines: [] }} />);

    expect(screen.getByText(/Ningún producto/)).toBeTruthy();
  });
});

describe('PriceChangePanel', () => {
  it('asks for a preview first and then applies it', async () => {
    const preview: PriceChangeState = {
      ...EMPTY_PRICE_CHANGE,
      preview: {
        request: { search: 'Truper', percent: '5', rounding: 'peso' },
        result: { applied: false, count: 2, lines: [] },
      },
    };
    const action = vi.fn(async (_previous: PriceChangeState, data: FormData): Promise<PriceChangeState> =>
      data.get('intent') === 'apply' ? { ...EMPTY_PRICE_CHANGE, appliedCount: 2 } : preview,
    );
    render(<PriceChangePanel action={action} />);

    fireEvent.click(screen.getByRole('button', { name: 'Ver vista previa' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Aplicar a 2 productos' }));

    await waitFor(() => expect(screen.getByText(/cambiaron 2 precios/)).toBeTruthy());
    expect(action.mock.calls.map(([, data]) => data.get('intent'))).toEqual(['preview', 'apply']);
  });
});
