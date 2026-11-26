import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { GivenUpProduct, ProductAdminApi, ProductPanelDetail, ReactivateProductResult, ReactivationPreview } from '../../shared/product-admin';
import { GivenUpProductsDialog } from './GivenUpProductsDialog';
import { ReactivateProductDialog } from './ReactivateProductDialog';

const TAPE_ID = '019a5f2e-7c40-7b1a-9d2e-3f4a5b6c7d90';
const TAPE: GivenUpProduct = {
  id: TAPE_ID,
  name: 'Cinta métrica 5 m',
  unit: 'piece',
  givenUpAt: '2026-11-20T16:30:00.000Z',
  givenUpByName: 'Mauricio',
  unitPriceE4: 895_000,
  effectiveCostE6: 52_250_000,
  stockMilli: 3_000,
  releasedCodes: ['7501234567890'],
};
const SHOVEL: GivenUpProduct = { ...TAPE, id: '019a5f2e-7c40-7b1a-9d2e-3f4a5b6c7d91', name: 'Pala cuadrada', givenUpAt: null, givenUpByName: null, stockMilli: 0, releasedCodes: [] };
const REACTIVATED: ProductPanelDetail = {
  id: TAPE_ID,
  name: 'Cinta métrica 5 m',
  unit: 'piece',
  unitPriceE4: 895_000,
  taxRate: { factor: 'rate', rateBp: 1600 },
  unitCostE6: null,
  effectiveCostE6: 52_250_000,
  isActive: true,
  revision: 5,
  barcodes: ['7501234567890'],
  releasedCodes: [],
  stockMilli: 3_000,
  movementCount: 1,
  recentMovements: [],
};

beforeAll(() => {
  // jsdom has no modal dialogs.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
});

afterEach(cleanup);

function previewOf(overrides: Partial<ReactivationPreview> = {}): ReactivationPreview {
  return { productId: TAPE_ID, name: 'Cinta métrica 5 m', revision: 4, releasedCodes: [{ code: '7501234567890', takenBy: null }], nameTakenBy: null, ...overrides };
}

function apiWith(overrides: Partial<ProductAdminApi> = {}): ProductAdminApi {
  return {
    createProduct: vi.fn(),
    findProducts: vi.fn(),
    getProductDetail: vi.fn(),
    updateProduct: vi.fn(),
    listGivenUpProducts: () => Promise.resolve({ status: 'listed', products: [TAPE, SHOVEL] }),
    previewReactivation: () => Promise.resolve(previewOf()),
    reactivateProduct: () => Promise.resolve<ReactivateProductResult>({ status: 'reactivated', product: REACTIVATED }),
    ...overrides,
  };
}

function rows(): HTMLElement[] {
  return within(screen.getByRole('table', { name: 'Productos dados de baja', hidden: true })).getAllByRole('row', { hidden: true }).slice(1);
}

describe('the screen of the given-up products (E1-62)', () => {
  it('lists, for the owner at once, who gave each product up and when, its last price and cost, the stock left and the codes', async () => {
    const listGivenUpProducts = vi.fn<ProductAdminApi['listGivenUpProducts']>(() => Promise.resolve({ status: 'listed', products: [TAPE, SHOVEL] }));
    render(<GivenUpProductsDialog productApi={apiWith({ listGivenUpProducts })} isOwner onClose={vi.fn()} />);

    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(listGivenUpProducts).toHaveBeenCalledExactlyOnceWith(undefined);
    const tape = rows()[0]!.textContent ?? '';
    expect(tape).toContain('Cinta métrica 5 m');
    expect(tape).toContain('Mauricio');
    expect(tape).toContain('$89.50');
    expect(tape).toContain('$52.25');
    expect(tape).toContain('Le quedan 3 pza: ajusta el inventario si ya no las tienes.');
    expect(tape).toContain('7501234567890');
    const shovel = rows()[1]!.textContent ?? '';
    expect(shovel).toContain('Sin fecha');
    expect(shovel).toContain('Ninguno');
    expect(shovel).not.toContain('Le quedan');
  });

  it('filters by part of the name or of a released code', async () => {
    render(<GivenUpProductsDialog productApi={apiWith()} isOwner onClose={vi.fn()} />);
    await waitFor(() => expect(rows()).toHaveLength(2));

    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar dados de baja', hidden: true }), { target: { value: '75012' } });
    expect(rows().map((row) => row.querySelector('th')?.textContent)).toEqual(['Cinta métrica 5 m']);
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar dados de baja', hidden: true }), { target: { value: 'PALA' } });
    expect(rows().map((row) => row.querySelector('th')?.textContent)).toEqual(['Pala cuadrada']);
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar dados de baja', hidden: true }), { target: { value: 'serrucho' } });
    expect(await screen.findByText('Ningún producto dado de baja coincide.')).toBeDefined();
  });

  it('asks a cashier for the PIN of the owner before showing anything, and explains a wrong one', async () => {
    const listGivenUpProducts = vi
      .fn<ProductAdminApi['listGivenUpProducts']>()
      .mockResolvedValueOnce({ status: 'wrong_pin', attemptsLeft: 4 })
      .mockResolvedValueOnce({ status: 'listed', products: [TAPE] });
    render(<GivenUpProductsDialog productApi={apiWith({ listGivenUpProducts })} isOwner={false} onClose={vi.fn()} />);

    expect(screen.queryByRole('table', { hidden: true })).toBeNull();
    expect(listGivenUpProducts).not.toHaveBeenCalled();
    const pin = screen.getByLabelText('PIN del dueño', { selector: 'input' });
    fireEvent.change(pin, { target: { value: '0000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ver la lista', hidden: true }));
    expect(await screen.findByText(/PIN del dueño incorrecto. Quedan 4 intentos/)).toBeDefined();

    fireEvent.change(screen.getByLabelText('PIN del dueño', { selector: 'input' }), { target: { value: '4321' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ver la lista', hidden: true }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(listGivenUpProducts).toHaveBeenLastCalledWith('4321');
  });

  it('reactivates from a row and reads the list again', async () => {
    const listGivenUpProducts = vi
      .fn<ProductAdminApi['listGivenUpProducts']>()
      .mockResolvedValueOnce({ status: 'listed', products: [TAPE, SHOVEL] })
      .mockResolvedValueOnce({ status: 'listed', products: [SHOVEL] });
    render(<GivenUpProductsDialog productApi={apiWith({ listGivenUpProducts })} isOwner onClose={vi.fn()} />);
    await waitFor(() => expect(rows()).toHaveLength(2));

    fireEvent.click(within(rows()[0]!).getByRole('button', { name: 'Reactivar', hidden: true }));
    await screen.findByRole('heading', { name: 'Reactivar Cinta métrica 5 m', hidden: true });
    fireEvent.keyDown(document.body, { key: 'F2' });

    expect(await screen.findByText('«Cinta métrica 5 m» está a la venta otra vez con 7501234567890.')).toBeDefined();
    await waitFor(() => expect(rows()).toHaveLength(1));
  });

  it('closes with Esc', async () => {
    const onClose = vi.fn();
    render(<GivenUpProductsDialog productApi={apiWith()} isOwner onClose={onClose} />);
    await waitFor(() => expect(rows()).toHaveLength(2));

    fireEvent.keyDown(document.body, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe('reactivating a product (E1-62)', () => {
  it('ticks the released codes that are free and sends them with the name and the revision', async () => {
    const reactivateProduct = vi.fn<ProductAdminApi['reactivateProduct']>(() => Promise.resolve<ReactivateProductResult>({ status: 'reactivated', product: REACTIVATED }));
    const onReactivated = vi.fn();
    render(<ReactivateProductDialog productApi={apiWith({ reactivateProduct })} productId={TAPE_ID} isOwner onReactivated={onReactivated} onCancel={vi.fn()} />);

    const code = await screen.findByRole<HTMLInputElement>('checkbox', { name: 'Recuperar 7501234567890', hidden: true });
    expect(code.checked).toBe(true);
    fireEvent.keyDown(document.body, { key: 'F2' });

    await waitFor(() =>
      expect(reactivateProduct).toHaveBeenCalledExactlyOnceWith({ productId: TAPE_ID, expectedRevision: 4, name: 'Cinta métrica 5 m', restoreCodes: ['7501234567890'] }),
    );
    expect(onReactivated).toHaveBeenCalledWith(REACTIVATED);
  });

  it('shows a code another product uses now with its owner, offers no box for it, and reactivates without it', async () => {
    const reactivateProduct = vi.fn<ProductAdminApi['reactivateProduct']>(() => Promise.resolve<ReactivateProductResult>({ status: 'reactivated', product: REACTIVATED }));
    const previewReactivation = () =>
      Promise.resolve(previewOf({ releasedCodes: [{ code: '7501234567890', takenBy: { productId: 'x', productName: 'Flexómetro 5 m' } }, { code: 'CINTA-5', takenBy: null }] }));
    render(<ReactivateProductDialog productApi={apiWith({ reactivateProduct, previewReactivation })} productId={TAPE_ID} isOwner onReactivated={vi.fn()} onCancel={vi.fn()} />);

    expect(await screen.findByText(/ya lo usa «Flexómetro 5 m». Se reactiva sin este código/)).toBeDefined();
    expect(screen.queryByRole('checkbox', { name: 'Recuperar 7501234567890', hidden: true })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Recuperar CINTA-5', hidden: true }));
    fireEvent.click(screen.getByRole('button', { name: /Reactivar/, hidden: true }));

    await waitFor(() => expect(reactivateProduct).toHaveBeenCalledWith(expect.objectContaining({ restoreCodes: [] })));
  });

  it('asks for another name when an active product has it, and explains a code taken meanwhile', async () => {
    const reactivateProduct = vi.fn<ProductAdminApi['reactivateProduct']>(() =>
      Promise.resolve<ReactivateProductResult>({ status: 'code_taken', code: '7501234567890', productId: 'x', productName: 'Flexómetro 5 m' }),
    );
    const previewReactivation = () => Promise.resolve(previewOf({ nameTakenBy: { productId: 'y', productName: 'Cinta Métrica 5 m' } }));
    render(<ReactivateProductDialog productApi={apiWith({ reactivateProduct, previewReactivation })} productId={TAPE_ID} isOwner onReactivated={vi.fn()} onCancel={vi.fn()} />);

    expect(await screen.findByText(/Ya hay un producto a la venta llamado «Cinta Métrica 5 m»/)).toBeDefined();
    expect(screen.getByText('Este nombre ya lo tiene otro producto a la venta.')).toBeDefined();
    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre', hidden: true }), { target: { value: 'Cinta métrica 5 m vieja' } });
    expect(screen.queryByText('Este nombre ya lo tiene otro producto a la venta.')).toBeNull();
    fireEvent.keyDown(document.body, { key: 'F2' });

    expect(await screen.findByText(/El código 7501234567890 ya lo usa «Flexómetro 5 m»/)).toBeDefined();
    expect(reactivateProduct).toHaveBeenCalledWith(expect.objectContaining({ name: 'Cinta métrica 5 m vieja' }));
  });

  it('makes a cashier type the PIN of an owner', async () => {
    const reactivateProduct = vi.fn<ProductAdminApi['reactivateProduct']>(() => Promise.resolve<ReactivateProductResult>({ status: 'reactivated', product: REACTIVATED }));
    render(<ReactivateProductDialog productApi={apiWith({ reactivateProduct })} productId={TAPE_ID} isOwner={false} onReactivated={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByRole('checkbox', { name: 'Recuperar 7501234567890', hidden: true });

    fireEvent.keyDown(document.body, { key: 'F2' });
    expect(await screen.findByText('Pídele al dueño que escriba su PIN.')).toBeDefined();
    expect(reactivateProduct).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('PIN del dueño', { selector: 'input' }), { target: { value: '4321' } });
    fireEvent.keyDown(document.body, { key: 'F2' });
    await waitFor(() => expect(reactivateProduct).toHaveBeenCalledWith(expect.objectContaining({ ownerPin: '4321' })));
  });
});
