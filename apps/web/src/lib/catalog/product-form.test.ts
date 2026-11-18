import { describe, expect, it } from 'vitest';
import { parseProductForm, productFormFromData, productFormFromProduct, type ProductFormInput } from './product-form';
import type { Product } from './types';

function input(overrides: Partial<ProductFormInput> = {}): ProductFormInput {
  return { ...productFormFromProduct(null), name: 'Cable THW calibre 12', unit: 'meter', ...overrides };
}

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
  unitPrice: '12.5000',
  taxFactor: 'rate',
  taxRateBp: 800,
  satProductKey: '26121600',
  satUnitKey: 'MTR',
  invoiceable: true,
  createdAt: '2026-11-17T00:00:00Z',
  updatedAt: '2026-11-17T00:00:00Z',
};

describe('parseProductForm', () => {
  it('builds the request of the core, with amounts as fixed-scale text', () => {
    const parsed = parseProductForm(
      input({
        barcodes: '7501000000012\n',
        alternates: 'CAB12',
        presentationNames: ['Rollo', ''],
        presentationQuantities: ['100', ''],
        unitPrice: '12.5',
        tax: 'rate-800',
        satProductKey: '26121600',
        satUnitKey: 'mtr',
      }),
    );

    expect(parsed).toEqual({
      ok: true,
      request: {
        name: 'Cable THW calibre 12',
        unit: 'meter',
        status: 'active',
        codes: [
          { code: '7501000000012', kind: 'barcode' },
          { code: 'CAB12', kind: 'alternate' },
        ],
        presentations: [{ name: 'Rollo', baseQuantity: '100.000' }],
        unitPrice: '12.5000',
        taxFactor: 'rate',
        taxRateBp: 800,
        satProductKey: '26121600',
        satUnitKey: 'MTR',
      },
    });
  });

  it('sends no price when the form has no price field', () => {
    const parsed = parseProductForm(input({ unitPrice: null }));

    expect(parsed.ok && 'unitPrice' in parsed.request).toBe(false);
  });

  it('collects every mistake at once, next to its field', () => {
    const parsed = parseProductForm(
      input({
        name: '  ',
        unit: 'box',
        unitPrice: '0',
        barcodes: '123\n123',
        presentationNames: ['Rollo'],
        presentationQuantities: ['0'],
        satProductKey: '123',
        satUnitKey: 'TOOLONG',
      }),
    );

    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? [] : Object.keys(parsed.errors).sort()).toEqual(
      ['codes', 'name', 'presentations', 'satProductKey', 'satUnitKey', 'unit', 'unitPrice'].sort(),
    );
  });

  it('refuses a code with spaces inside', () => {
    const parsed = parseProductForm(input({ barcodes: '750 100' }));

    expect(parsed.ok ? null : parsed.errors.codes).toMatch(/no es válido/);
  });

  it('marks an exempt product without a rate', () => {
    const parsed = parseProductForm(input({ tax: 'exempt' }));

    expect(parsed.ok && [parsed.request.taxFactor, parsed.request.taxRateBp]).toEqual(['exempt', 0]);
  });
});

describe('productFormFromProduct', () => {
  it('fills the form so that saving it unchanged sends the same product', () => {
    const form = productFormFromProduct(PRODUCT);
    const parsed = parseProductForm(form);

    expect(form.tax).toBe('rate-800');
    expect(parsed.ok && parsed.request).toMatchObject({
      codes: PRODUCT.codes,
      presentations: PRODUCT.presentations,
      satUnitKey: 'MTR',
    });
  });
});

describe('productFormFromData', () => {
  it('reads repeated presentation fields in order', () => {
    const data = new FormData();
    data.set('name', 'Lija');
    data.append('presentationName', 'Caja');
    data.append('presentationQuantity', '50');
    data.append('presentationName', 'Paquete');
    data.append('presentationQuantity', '10');
    data.set('unitPrice', '9');

    const form = productFormFromData(data, false);

    expect(form.presentationNames).toEqual(['Caja', 'Paquete']);
    expect(form.presentationQuantities).toEqual(['50', '10']);
    expect(form.unitPrice).toBeNull();
  });
});
