import {
  MAX_ORDER_LINES,
  type ChangeSupplierLinkRequest,
  MAX_CODES_PER_SUPPLIER_PRODUCT,
  type ExportOrderRequest,
  type OrderActionRequest,
  type OrderMoreRequest,
  type OrderLineRequest,
  type SaveOrderRequest,
  type SaveSupplierRequest,
  type SearchOrderProductsRequest,
  type SetReorderLevelRequest,
  type SetSupplierCodesRequest,
  type SupplierCode,
  type SupplierProductRef,
  type UnlinkSupplierRequest,
} from '../../shared/supplier-order';
import { parseProductId } from '../inventory/inventory-request';
import { parseOwnerPin } from '../products/product-request';

/** A text longer than this is not a name, a code or a note, so it is refused before anything looks at it. */
const MAX_TEXT_LENGTH = 1000;

function asRecord(value: unknown, description: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`Expected ${description}`);
  }
  return value as Record<string, unknown>;
}

function requireText(value: unknown, description: string): string {
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) {
    throw new TypeError(`Expected ${description} as text of at most ${MAX_TEXT_LENGTH} characters`);
  }
  return value;
}

function nullableText(value: unknown, description: string): string | null {
  return value === null ? null : requireText(value, description);
}

function requireInteger(value: unknown, description: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`Expected ${description} as a whole number of zero or more`);
  }
  return value;
}

function nullableInteger(value: unknown, description: string): number | null {
  return value === null ? null : requireInteger(value, description);
}

const UUID_V7_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Checks the id of a supplier or of an order that came over the bridge.
 *
 * @param value what the screen sent
 * @param description what the id is, for the error
 * @returns the id
 * @throws TypeError if it is not a UUIDv7
 */
export function parseUuid(value: unknown, description: string): string {
  if (typeof value !== 'string' || !UUID_V7_TEXT.test(value)) {
    throw new TypeError(`Expected the UUIDv7 of ${description}`);
  }
  return value;
}

/**
 * Checks a supplier that came over the bridge. The service checks the rules of the business; this checks the shape.
 *
 * @param value what the screen sent
 * @returns the request, with only the fields it knows
 * @throws TypeError if something is missing or has the wrong type
 */
export function parseSaveSupplierRequest(value: unknown): SaveSupplierRequest {
  const request = asRecord(value, 'a supplier');
  if (typeof request.isActive !== 'boolean') {
    throw new TypeError('Expected whether the supplier is active');
  }
  const ownerPin = parseOwnerPin(request.ownerPin);
  return {
    ...(request.supplierId === undefined ? {} : { supplierId: parseUuid(request.supplierId, 'a supplier') }),
    ...(request.expectedRevision === undefined ? {} : { expectedRevision: requireInteger(request.expectedRevision, 'the revision') }),
    name: requireText(request.name, 'the name'),
    contact: nullableText(request.contact, 'the contact'),
    notes: nullableText(request.notes, 'the notes'),
    isActive: request.isActive,
    ...(ownerPin === undefined ? {} : { ownerPin }),
  };
}

function parseCodes(value: unknown): SupplierCode[] {
  if (!Array.isArray(value) || value.length > MAX_CODES_PER_SUPPLIER_PRODUCT) {
    throw new TypeError('Expected a list of codes of the supplier');
  }
  return value.map((entry) => {
    const code = asRecord(entry, 'a code of the supplier');
    return {
      supplierCode: requireText(code.supplierCode, 'the code of the supplier'),
      listCostE6: nullableInteger(code.listCostE6, 'the list cost'),
      purchaseUnit: nullableText(code.purchaseUnit, 'the presentation'),
    };
  });
}

/**
 * Checks the codes of a supplier for a product that came over the bridge.
 *
 * @param value what the screen sent
 * @returns the request
 * @throws TypeError if something is missing or has the wrong type
 */
export function parseSetSupplierCodesRequest(value: unknown): SetSupplierCodesRequest {
  const request = asRecord(value, 'the codes of a supplier');
  const ownerPin = parseOwnerPin(request.ownerPin);
  return {
    supplierId: parseUuid(request.supplierId, 'a supplier'),
    productId: parseProductId(request.productId),
    codes: parseCodes(request.codes),
    ...(ownerPin === undefined ? {} : { ownerPin }),
  };
}

/**
 * Checks a change of one supplier of a product that came over the bridge (E1-58).
 *
 * @param value what the screen sent
 * @returns the request
 * @throws TypeError if something is missing or has the wrong type
 */
export function parseChangeSupplierLinkRequest(value: unknown): ChangeSupplierLinkRequest {
  const request = asRecord(value, 'a change of a supplier of a product');
  const ownerPin = parseOwnerPin(request.ownerPin);
  return {
    productId: parseProductId(request.productId),
    fromSupplierId: parseUuid(request.fromSupplierId, 'the supplier the product has'),
    toSupplierId: parseUuid(request.toSupplierId, 'the supplier the product will have'),
    codes: parseCodes(request.codes),
    ...(ownerPin === undefined ? {} : { ownerPin }),
  };
}

/**
 * Checks a supplier and a product that came over the bridge.
 *
 * @param value what the screen sent
 * @returns the supplier and the product
 * @throws TypeError if something is missing or has the wrong type
 */
export function parseSupplierProductRef(value: unknown): SupplierProductRef {
  const ref = asRecord(value, 'a supplier and a product');
  return { supplierId: parseUuid(ref.supplierId, 'a supplier'), productId: parseProductId(ref.productId) };
}

/**
 * Checks the removal of a supplier from a product that came over the bridge (E1-58).
 *
 * @param value what the screen sent
 * @returns the request
 * @throws TypeError if something is missing or has the wrong type
 */
export function parseUnlinkSupplierRequest(value: unknown): UnlinkSupplierRequest {
  const request = asRecord(value, 'the removal of a supplier');
  if (typeof request.removeFromDrafts !== 'boolean') {
    throw new TypeError('Expected whether to take the product off the drafts');
  }
  const ownerPin = parseOwnerPin(request.ownerPin);
  return {
    ...parseSupplierProductRef(request),
    removeFromDrafts: request.removeFromDrafts,
    ...(ownerPin === undefined ? {} : { ownerPin }),
  };
}

/**
 * Checks a search for products to order that came over the bridge.
 *
 * @param value what the screen sent
 * @returns the request
 * @throws TypeError if something is missing or has the wrong type
 */
export function parseSearchOrderProductsRequest(value: unknown): SearchOrderProductsRequest {
  const request = asRecord(value, 'a search');
  return {
    supplierId: request.supplierId === null ? null : parseUuid(request.supplierId, 'a supplier'),
    text: requireText(request.text, 'the text'),
  };
}

/**
 * Checks a reorder level that came over the bridge.
 *
 * @param value what the screen sent
 * @returns the request
 * @throws TypeError if something is missing or has the wrong type
 */
export function parseSetReorderLevelRequest(value: unknown): SetReorderLevelRequest {
  const request = asRecord(value, 'a reorder level');
  const ownerPin = parseOwnerPin(request.ownerPin);
  return {
    productId: parseProductId(request.productId),
    minimumMilli: requireInteger(request.minimumMilli, 'the minimum'),
    maximumMilli: nullableInteger(request.maximumMilli, 'the maximum'),
    ...(ownerPin === undefined ? {} : { ownerPin }),
  };
}

function parseLine(value: unknown): OrderLineRequest {
  const line = asRecord(value, 'a line of the order');
  return {
    productId: parseProductId(line.productId),
    supplierCode: nullableText(line.supplierCode, 'the code of the supplier'),
    quantityMilli: requireInteger(line.quantityMilli, 'the quantity'),
    unitCostE6: nullableInteger(line.unitCostE6, 'the cost'),
  };
}

/**
 * Checks an order that came over the bridge. The service checks the rules of the business, such as the units and the limits;
 * this checks the shape.
 *
 * @param value what the screen sent
 * @returns the request
 * @throws TypeError if something is missing or has the wrong type
 */
export function parseSaveOrderRequest(value: unknown): SaveOrderRequest {
  const request = asRecord(value, 'an order');
  if (!Array.isArray(request.lines) || request.lines.length > MAX_ORDER_LINES) {
    throw new TypeError(`Expected a list of at most ${MAX_ORDER_LINES} lines`);
  }
  const ownerPin = parseOwnerPin(request.ownerPin);
  return {
    ...(request.orderId === undefined ? {} : { orderId: parseUuid(request.orderId, 'an order') }),
    ...(request.expectedRevision === undefined ? {} : { expectedRevision: requireInteger(request.expectedRevision, 'the revision') }),
    supplierId: parseUuid(request.supplierId, 'a supplier'),
    notes: nullableText(request.notes, 'the notes'),
    lines: request.lines.map(parseLine),
    ...(ownerPin === undefined ? {} : { ownerPin }),
  };
}

/**
 * Checks the request to send or discard an order that came over the bridge.
 *
 * @param value what the screen sent
 * @returns the request
 * @throws TypeError if something is missing or has the wrong type
 */
export function parseOrderActionRequest(value: unknown): OrderActionRequest {
  const request = asRecord(value, 'an order action');
  const ownerPin = parseOwnerPin(request.ownerPin);
  return {
    orderId: parseUuid(request.orderId, 'an order'),
    expectedRevision: requireInteger(request.expectedRevision, 'the revision'),
    ...(ownerPin === undefined ? {} : { ownerPin }),
  };
}

/**
 * Checks the request to add a product to the draft order of a supplier that came over the bridge.
 *
 * @param value what the screen sent
 * @returns the request
 * @throws TypeError if it is not shaped as one
 */
export function parseOrderMoreRequest(value: unknown): OrderMoreRequest {
  const request = asRecord(value, 'a request to order more');
  const ownerPin = parseOwnerPin(request.ownerPin);
  return {
    productId: parseProductId(request.productId),
    supplierId: parseUuid(request.supplierId, 'a supplier'),
    ...(ownerPin === undefined ? {} : { ownerPin }),
  };
}

/**
 * Checks the request to export an order that came over the bridge.
 *
 * @param value what the screen sent
 * @returns the request
 * @throws TypeError if something is missing or has the wrong type
 */
export function parseExportOrderRequest(value: unknown): ExportOrderRequest {
  const request = asRecord(value, 'an export');
  if (request.format !== 'xlsx' && request.format !== 'pdf') {
    throw new TypeError('Expected the format to be xlsx or pdf');
  }
  const ownerPin = parseOwnerPin(request.ownerPin);
  return {
    orderId: parseUuid(request.orderId, 'an order'),
    format: request.format,
    ...(ownerPin === undefined ? {} : { ownerPin }),
  };
}

/**
 * Checks a path that came over the bridge.
 *
 * @param value what the screen sent
 * @returns the path
 * @throws TypeError if it is not a text
 */
export function parsePath(value: unknown): string {
  return requireText(value, 'a path');
}
