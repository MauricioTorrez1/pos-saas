import { describe, expect, it } from 'vitest';

import {
  parseExportOrderRequest,
  parseOrderActionRequest,
  parseSaveOrderRequest,
  parseSaveSupplierRequest,
  parseSearchOrderProductsRequest,
  parseSetReorderLevelRequest,
  parseSetSupplierCodesRequest,
} from './purchasing-request';

const ID = '0193a5c0-0000-7000-8000-000000000001';
const PRODUCT = '0193a5c0-0000-7000-8000-000000000060';

describe('what crosses the bridge of the purchase order (E1-44)', () => {
  it('reads a supplier with only the fields it knows', () => {
    expect(parseSaveSupplierRequest({ name: 'A', contact: null, notes: 'n', isActive: true, extra: 'ignored', ownerPin: '4321' })).toEqual({
      name: 'A',
      contact: null,
      notes: 'n',
      isActive: true,
      ownerPin: '4321',
    });
    expect(() => parseSaveSupplierRequest({ name: 'A', contact: null, notes: null })).toThrow(TypeError);
    expect(() => parseSaveSupplierRequest({ supplierId: 'not-a-uuid', name: 'A', contact: null, notes: null, isActive: true })).toThrow(TypeError);
    expect(() => parseSaveSupplierRequest({ name: 'x'.repeat(1001), contact: null, notes: null, isActive: true })).toThrow(TypeError);
    expect(() => parseSaveSupplierRequest('text')).toThrow(TypeError);
    expect(() => parseSaveSupplierRequest({ name: 'A', contact: null, notes: null, isActive: true, ownerPin: '123456789' })).toThrow(TypeError);
  });

  it('reads the codes of a supplier and refuses a cost with decimals or too many codes', () => {
    const request = { supplierId: ID, productId: PRODUCT, codes: [{ supplierCode: 'A1', listCostE6: 1_000_000, purchaseUnit: null }] };

    expect(parseSetSupplierCodesRequest(request).codes).toHaveLength(1);
    expect(() => parseSetSupplierCodesRequest({ ...request, codes: [{ supplierCode: 'A1', listCostE6: 1.5, purchaseUnit: null }] })).toThrow(TypeError);
    expect(() => parseSetSupplierCodesRequest({ ...request, codes: Array.from({ length: 11 }, () => ({ supplierCode: 'A', listCostE6: null, purchaseUnit: null })) })).toThrow(TypeError);
    expect(() => parseSetSupplierCodesRequest({ ...request, productId: 'x' })).toThrow(TypeError);
  });

  it('reads a search with or without a supplier', () => {
    expect(parseSearchOrderProductsRequest({ supplierId: null, text: 'cinta' })).toEqual({ supplierId: null, text: 'cinta' });
    expect(parseSearchOrderProductsRequest({ supplierId: ID, text: '7501234567890' }).supplierId).toBe(ID);
    expect(() => parseSearchOrderProductsRequest({ supplierId: 5, text: 'x' })).toThrow(TypeError);
  });

  it('reads a reorder level', () => {
    expect(parseSetReorderLevelRequest({ productId: PRODUCT, minimumMilli: 5_000, maximumMilli: null })).toEqual({ productId: PRODUCT, minimumMilli: 5_000, maximumMilli: null });
    expect(() => parseSetReorderLevelRequest({ productId: PRODUCT, minimumMilli: -1, maximumMilli: null })).toThrow(TypeError);
    expect(() => parseSetReorderLevelRequest({ productId: PRODUCT, minimumMilli: 1.5, maximumMilli: null })).toThrow(TypeError);
  });

  it('reads an order with its lines, and refuses a line that is not whole numbers', () => {
    const order = { supplierId: ID, notes: null, lines: [{ productId: PRODUCT, supplierCode: null, quantityMilli: 12_000, unitCostE6: null }] };

    expect(parseSaveOrderRequest(order)).toEqual(order);
    expect(parseSaveOrderRequest({ ...order, orderId: ID, expectedRevision: 2 })).toMatchObject({ orderId: ID, expectedRevision: 2 });
    expect(() => parseSaveOrderRequest({ ...order, lines: [{ productId: PRODUCT, supplierCode: null, quantityMilli: 1.5, unitCostE6: null }] })).toThrow(TypeError);
    expect(() => parseSaveOrderRequest({ ...order, lines: Array.from({ length: 201 }, () => order.lines[0]) })).toThrow(TypeError);
    expect(() => parseSaveOrderRequest({ ...order, lines: 'many' })).toThrow(TypeError);
  });

  it('reads the actions on an order and the kind of file', () => {
    expect(parseOrderActionRequest({ orderId: ID, expectedRevision: 1 })).toEqual({ orderId: ID, expectedRevision: 1 });
    expect(() => parseOrderActionRequest({ orderId: ID })).toThrow(TypeError);
    expect(parseExportOrderRequest({ orderId: ID, format: 'pdf' })).toEqual({ orderId: ID, format: 'pdf' });
    expect(() => parseExportOrderRequest({ orderId: ID, format: 'docx' })).toThrow(TypeError);
  });
});
