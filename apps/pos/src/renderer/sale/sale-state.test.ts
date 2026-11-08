import { describe, expect, it } from 'vitest';

import type { CatalogProduct } from '../../shared/pos-api';
import { AMOUNT_TOO_LARGE, EMPTY_SALE, saleReducer, type SaleAction, type SaleState } from './sale-state';

const HAMMER: CatalogProduct = {
  id: 'hammer',
  name: 'Martillo',
  unit: 'piece',
  unitPriceE4: 1_160_000,
  taxRate: { factor: 'rate', rateBp: 1600 },
};
const CABLE: CatalogProduct = {
  id: 'cable',
  name: 'Cable',
  unit: 'meter',
  unitPriceE4: 125_000,
  taxRate: { factor: 'rate', rateBp: 1600 },
};
const SEEDS: CatalogProduct = {
  id: 'seeds',
  name: 'Semilla',
  unit: 'piece',
  unitPriceE4: 850_000,
  taxRate: { factor: 'exempt', rateBp: 0 },
};
const PRICELESS: CatalogProduct = { ...HAMMER, id: 'priceless', unitPriceE4: Number.MAX_SAFE_INTEGER };

function apply(...actions: SaleAction[]): SaleState {
  return actions.reduce(saleReducer, EMPTY_SALE);
}

function add(product: CatalogProduct): SaleAction {
  return { type: 'add-product', product };
}

describe('saleReducer', () => {
  it('adds a product as one unit and selects it', () => {
    const sale = apply(add(HAMMER));

    expect(sale.lines).toHaveLength(1);
    expect(sale.lines[0]!.quantity).toEqual({ milli: 1000, unit: 'piece' });
    expect(sale.selectedProductId).toBe('hammer');
    expect(sale.totals.totalCents).toBe(11600);
  });

  it('adds one more unit when the product is already in the sale', () => {
    const sale = apply(add(HAMMER), add(CABLE), add(HAMMER));

    expect(sale.lines.map((line) => line.product.id)).toEqual(['hammer', 'cable']);
    expect(sale.lines[0]!.quantity.milli).toBe(2000);
    expect(sale.selectedProductId).toBe('hammer');
    expect(sale.totals.totalCents).toBe(23200 + 1250);
  });

  it('keeps the unchanged lines as the same objects, so the screen does not redraw them', () => {
    const before = apply(add(HAMMER), add(CABLE));

    const after = saleReducer(before, add(HAMMER));

    expect(after.lines[1]).toBe(before.lines[1]);
    expect(after.lines[0]).not.toBe(before.lines[0]);
  });

  it('groups the VAT by rate', () => {
    const { totals } = apply(add(HAMMER), add(SEEDS));

    expect(totals.taxGroups.map(({ taxRate }) => taxRate.factor)).toEqual(['rate', 'exempt']);
    expect(totals.taxCents).toBe(1600);
  });

  it('changes the quantity of the selected line', () => {
    const sale = apply(add(CABLE), { type: 'change-quantity', units: 1 });

    expect(sale.lines[0]!.quantity).toEqual({ milli: 2000, unit: 'meter' });
    expect(sale.totals.totalCents).toBe(2500);
  });

  it('does not go below one unit', () => {
    const before = apply(add(HAMMER));

    expect(saleReducer(before, { type: 'change-quantity', units: -1 })).toBe(before);
  });

  it('ignores quantity keys when nothing is selected', () => {
    expect(saleReducer(EMPTY_SALE, { type: 'change-quantity', units: 1 })).toBe(EMPTY_SALE);
  });

  it('removes the selected line and selects the one that takes its place', () => {
    const sale = apply(add(HAMMER), add(CABLE), add(SEEDS), { type: 'select', productId: 'cable' }, { type: 'remove-selected' });

    expect(sale.lines.map((line) => line.product.id)).toEqual(['hammer', 'seeds']);
    expect(sale.selectedProductId).toBe('seeds');
    expect(sale.totals.totalCents).toBe(11600 + 8500);
  });

  it('selects the previous line after removing the last one', () => {
    const sale = apply(add(HAMMER), add(CABLE), { type: 'remove-selected' });

    expect(sale.selectedProductId).toBe('hammer');
  });

  it('is back at zero after removing the only line', () => {
    const sale = apply(add(HAMMER), { type: 'remove-selected' });

    expect(sale.lines).toEqual([]);
    expect(sale.selectedProductId).toBeNull();
    expect(sale.totals.totalCents).toBe(0);
  });

  it('ignores a removal when nothing is selected', () => {
    expect(saleReducer(EMPTY_SALE, { type: 'remove-selected' })).toBe(EMPTY_SALE);
  });

  it('moves the selection and stops at both ends', () => {
    const atLast = apply(add(HAMMER), add(CABLE));

    const atFirst = saleReducer(atLast, { type: 'move-selection', offset: -1 });

    expect(atFirst.selectedProductId).toBe('hammer');
    expect(saleReducer(atFirst, { type: 'move-selection', offset: -1 }).selectedProductId).toBe('hammer');
    expect(saleReducer(atLast, { type: 'move-selection', offset: 1 }).selectedProductId).toBe('cable');
  });

  it('leaves an empty sale alone when asked to move the selection', () => {
    expect(saleReducer(EMPTY_SALE, { type: 'move-selection', offset: 1 })).toBe(EMPTY_SALE);
  });

  it('explains an amount that is too large and keeps the sale as it was', () => {
    const before = apply(add(PRICELESS));

    // At the largest price, a second unit no longer fits in the calculation of the line.
    const after = saleReducer(before, add(PRICELESS));

    expect(after.problem).toBe(AMOUNT_TOO_LARGE);
    expect(after.lines).toBe(before.lines);
    expect(after.totals).toBe(before.totals);
  });

  it('clears the problem after the next good change', () => {
    const sale = apply(add(PRICELESS), add(PRICELESS), add(CABLE));

    expect(sale.problem).toBeNull();
    expect(sale.lines).toHaveLength(2);
  });
});
