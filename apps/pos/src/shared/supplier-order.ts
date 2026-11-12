import type { Unit } from '@pos-saas/money';

/** The longest name of a supplier. It is the limit of the contract with the core. */
export const MAX_SUPPLIER_NAME_LENGTH = 100;
/** The longest contact text of a supplier (phone, e-mail, who to ask for). */
export const MAX_SUPPLIER_CONTACT_LENGTH = 200;
/** The longest note, of a supplier or of an order. */
export const MAX_NOTES_LENGTH = 500;
/** The longest code a supplier gives to a product. */
export const MAX_SUPPLIER_CODE_LENGTH = 64;
/** The longest description of a purchase presentation, such as "Caja con 12 piezas". */
export const MAX_PURCHASE_UNIT_LENGTH = 60;
/** The most codes one supplier can have for one product. */
export const MAX_CODES_PER_SUPPLIER_PRODUCT = 10;
/** The most lines an order has. */
export const MAX_ORDER_LINES = 200;
/** The most a line orders, in thousandths of the unit: 100,000 units. It keeps every total inside a safe integer. */
export const MAX_ORDER_QUANTITY_MILLI = 100_000_000;
/** The highest cost per unit an order accepts, in millionths of a peso: $1,000,000.00. */
export const MAX_ORDER_UNIT_COST_E6 = 1_000_000_000_000;
/** The highest reorder level, in thousandths of the unit. */
export const MAX_REORDER_LEVEL_MILLI = 1_000_000_000;

const COST_SCALE_PER_CENT = 10_000_000n;

/**
 * Works out what a line of an order costs: a cost per unit in millionths of a peso times a quantity in thousandths of the
 * unit, in cents, rounded half up like every line of the register (ADR 0011). It never uses a decimal number.
 *
 * @param unitCostE6 the estimated cost per unit in millionths of a peso: $58.25 is 58250000
 * @param quantityMilli the quantity in thousandths of the unit: 2.5 m is 2500
 * @returns the amount in cents
 * @throws RangeError if the cost or the quantity is not a whole number of zero or more, or the amount is too big
 */
export function orderLineCents(unitCostE6: number, quantityMilli: number): number {
  if (!Number.isSafeInteger(unitCostE6) || unitCostE6 < 0 || !Number.isSafeInteger(quantityMilli) || quantityMilli < 0) {
    throw new RangeError('The cost and the quantity must be whole numbers of zero or more');
  }
  const cents = (BigInt(unitCostE6) * BigInt(quantityMilli) + COST_SCALE_PER_CENT / 2n) / COST_SCALE_PER_CENT;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('The amount of the line is too big');
  }
  return Number(cents);
}

/** A supplier of the business. It is given up, never deleted: the orders already sent point at it. */
export interface Supplier {
  /** UUIDv7 of the supplier. */
  readonly id: string;
  readonly name: string;
  readonly contact: string | null;
  readonly notes: string | null;
  /** False once the supplier was given up: it is not offered for a new order. */
  readonly isActive: boolean;
  /** Goes up by one with every change, so a screen can tell that the supplier changed while it was edited. */
  readonly revision: number;
}

/** What a supplier calls a product, and what it asks for it. */
export interface SupplierCode {
  /** The code or SKU of the supplier. */
  readonly supplierCode: string;
  /** The list cost per unit of the register in millionths of a peso, when the supplier's list is known. */
  readonly listCostE6: number | null;
  /** How the supplier sells it, such as "Caja con 12". Informative: the cost and the quantity are per unit of the product. */
  readonly purchaseUnit: string | null;
}

/** The codes one supplier gives to one product. */
export interface SupplierProductLink {
  readonly supplierId: string;
  readonly supplierName: string;
  readonly productId: string;
  readonly codes: readonly SupplierCode[];
}

/** Why an owner's approval was not given. The same answers as the other screens that need an owner. */
export type OwnerRefusalResult =
  | { readonly status: 'authorization_required' }
  | { readonly status: 'wrong_pin'; readonly attemptsLeft: number }
  | { readonly status: 'locked'; readonly until: string };

/** What the person asks for to add or change a supplier. */
export interface SaveSupplierRequest {
  /** The supplier to change. Without it, a new one is added. */
  readonly supplierId?: string;
  /** The revision the screen saw. Required with `supplierId`. */
  readonly expectedRevision?: number;
  readonly name: string;
  readonly contact: string | null;
  readonly notes: string | null;
  readonly isActive: boolean;
  /** The PIN of an owner, when a cashier asks. */
  readonly ownerPin?: string;
}

/** How saving a supplier ended. */
export type SaveSupplierResult =
  | { readonly status: 'saved'; readonly supplier: Supplier }
  /** Nothing differs from what is stored, so nothing was written. */
  | { readonly status: 'unchanged'; readonly supplier: Supplier }
  | { readonly status: 'duplicate_name'; readonly supplierId: string; readonly name: string }
  | { readonly status: 'stale'; readonly supplier: Supplier }
  | { readonly status: 'not_found' }
  | OwnerRefusalResult;

/** What the person asks for to set the codes one supplier gives to one product. An empty list removes them all. */
export interface SetSupplierCodesRequest {
  readonly supplierId: string;
  readonly productId: string;
  readonly codes: readonly SupplierCode[];
  readonly ownerPin?: string;
}

/** How setting the codes ended. */
export type SetSupplierCodesResult =
  | { readonly status: 'saved'; readonly links: readonly SupplierProductLink[] }
  | { readonly status: 'unchanged'; readonly links: readonly SupplierProductLink[] }
  | { readonly status: 'supplier_not_found' }
  | { readonly status: 'product_not_found' }
  | OwnerRefusalResult;

/** What the person asks for to find products to order. */
export interface SearchOrderProductsRequest {
  /** The supplier the order is for, so its codes are searched and shown. Null looks only at names and barcodes. */
  readonly supplierId: string | null;
  /** A barcode, a code of the supplier, or words of the name. */
  readonly text: string;
}

/** A product that can go on an order, with what the screen needs to fill the line. */
export interface OrderCandidate {
  readonly productId: string;
  readonly name: string;
  readonly unit: Unit;
  /** The first barcode of the product, or null if it has none. */
  readonly barcode: string | null;
  /** The sum of the ledger, in thousandths of the unit. */
  readonly stockMilli: number;
  /** The cost of the supplier's list if it has one for this product, else the cost of the product. Null if neither is known. */
  readonly estimatedCostE6: number | null;
  /** The codes this supplier gives to the product, the one that was searched first. */
  readonly supplierCodes: readonly SupplierCode[];
  readonly minimumMilli: number | null;
  readonly maximumMilli: number | null;
  /** What to order to get back to the reorder level, or null when the product has no level or is not low. Never forced. */
  readonly suggestedMilli: number | null;
  /** How it was found. */
  readonly matchedBy: 'barcode' | 'supplier_code' | 'name' | 'low_stock';
}

/** When to order a product and how far to fill. The minimum is above zero, and the maximum above the minimum. */
export interface SetReorderLevelRequest {
  readonly productId: string;
  readonly minimumMilli: number;
  /** Order up to here. Without it, the suggestion fills up to twice the minimum. */
  readonly maximumMilli: number | null;
  readonly ownerPin?: string;
}

/** How setting a reorder level ended. */
export type SetReorderLevelResult =
  | { readonly status: 'saved'; readonly candidate: OrderCandidate }
  | { readonly status: 'product_not_found' }
  | OwnerRefusalResult;

/** One line of an order as the screen asks to save it. */
export interface OrderLineRequest {
  readonly productId: string;
  /** The code of the supplier printed on the line, or null. */
  readonly supplierCode: string | null;
  /** In thousandths of the unit of the product, above zero. */
  readonly quantityMilli: number;
  /** The estimated cost per unit in millionths of a peso, or null when it is not known. */
  readonly unitCostE6: number | null;
}

/** What the person asks for to save an order as a draft. */
export interface SaveOrderRequest {
  /** The draft to change. Without it, a new one is created. */
  readonly orderId?: string;
  /** The revision the screen saw. Required with `orderId`. */
  readonly expectedRevision?: number;
  readonly supplierId: string;
  readonly notes: string | null;
  readonly lines: readonly OrderLineRequest[];
  readonly ownerPin?: string;
}

/** A line of a saved order. The name, the barcode and the code are copied, so the order reads the same later. */
export interface OrderLine {
  readonly lineNumber: number;
  readonly productId: string;
  readonly description: string;
  readonly supplierCode: string | null;
  readonly barcode: string | null;
  readonly unit: Unit;
  readonly quantityMilli: number;
  readonly unitCostE6: number | null;
  /** Null when the cost is not known. */
  readonly lineTotalCents: number | null;
}

/** The state of an order. A sent order never changes again. */
export type OrderStatus = 'draft' | 'sent';

/** An order to a supplier, a document of the register: it moves no stock (the reception is F2-13). */
export interface PurchaseOrder {
  /** UUIDv7 of the order. */
  readonly id: string;
  /** The number the owner reads aloud, from 1 and without gaps per business. */
  readonly folio: number;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly status: OrderStatus;
  readonly notes: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** When it was marked as sent, or null for a draft. */
  readonly sentAt: string | null;
  readonly revision: number;
  readonly lines: readonly OrderLine[];
  /** The sum of the lines that have a cost, in cents. */
  readonly totalCents: number;
  /** How many lines have no cost and so are not in the total. */
  readonly linesWithoutCost: number;
}

/** An order in the list. */
export interface PurchaseOrderSummary {
  readonly id: string;
  readonly folio: number;
  readonly supplierName: string;
  readonly status: OrderStatus;
  readonly updatedAt: string;
  readonly lineCount: number;
  readonly totalCents: number;
}

/** How saving a draft ended. */
export type SaveOrderResult =
  | { readonly status: 'saved'; readonly order: PurchaseOrder }
  | { readonly status: 'not_found' }
  | { readonly status: 'supplier_not_found' }
  /** One of the products no longer exists. */
  | { readonly status: 'product_not_found'; readonly productId: string }
  /** The order was sent or changed after the screen loaded it, so nothing was written. */
  | { readonly status: 'stale'; readonly order: PurchaseOrder }
  | OwnerRefusalResult;

/** What the person asks for when they act on a saved order. */
export interface OrderActionRequest {
  readonly orderId: string;
  /** The revision the screen saw. */
  readonly expectedRevision: number;
  readonly ownerPin?: string;
}

/** How marking an order as sent ended. */
export type MarkOrderSentResult =
  | { readonly status: 'sent'; readonly order: PurchaseOrder }
  | { readonly status: 'not_found' }
  | { readonly status: 'stale'; readonly order: PurchaseOrder }
  | { readonly status: 'already_sent'; readonly order: PurchaseOrder }
  | { readonly status: 'empty' }
  | OwnerRefusalResult;

/** How discarding a draft ended. */
export type DiscardOrderResult =
  | { readonly status: 'discarded' }
  | { readonly status: 'not_found' }
  | { readonly status: 'stale'; readonly order: PurchaseOrder }
  | { readonly status: 'already_sent'; readonly order: PurchaseOrder }
  | OwnerRefusalResult;

/** The files an order can be turned into. */
export type OrderFileFormat = 'xlsx' | 'pdf';

/** What the person asks for to get a file of an order. */
export interface ExportOrderRequest {
  readonly orderId: string;
  readonly format: OrderFileFormat;
  readonly ownerPin?: string;
}

/** How exporting ended. */
export type ExportOrderResult =
  | { readonly status: 'saved'; readonly path: string }
  /** The person closed the window to choose where to save. */
  | { readonly status: 'cancelled' }
  | { readonly status: 'not_found' }
  | { readonly status: 'failed'; readonly message: string }
  | OwnerRefusalResult;

/** What the screens of the purchase order reach in the main process (E1-44, ADR 0059). */
export interface PurchasingApi {
  listSuppliers(includeInactive: boolean): Promise<Supplier[]>;
  saveSupplier(request: SaveSupplierRequest): Promise<SaveSupplierResult>;
  getSupplierLinks(productId: string): Promise<SupplierProductLink[]>;
  setSupplierCodes(request: SetSupplierCodesRequest): Promise<SetSupplierCodesResult>;
  searchOrderProducts(request: SearchOrderProductsRequest): Promise<OrderCandidate[]>;
  suggestOrderProducts(supplierId: string): Promise<OrderCandidate[]>;
  setReorderLevel(request: SetReorderLevelRequest): Promise<SetReorderLevelResult>;
  listOrders(): Promise<PurchaseOrderSummary[]>;
  getOrder(orderId: string): Promise<PurchaseOrder | null>;
  saveOrder(request: SaveOrderRequest): Promise<SaveOrderResult>;
  markOrderSent(request: OrderActionRequest): Promise<MarkOrderSentResult>;
  discardOrder(request: OrderActionRequest): Promise<DiscardOrderResult>;
  exportOrder(request: ExportOrderRequest): Promise<ExportOrderResult>;
  revealFile(path: string): Promise<void>;
}

/** The names of the channels of the purchase order bridge. */
export const PURCHASING_CHANNELS = {
  listSuppliers: 'purchasing:list-suppliers',
  saveSupplier: 'purchasing:save-supplier',
  getSupplierLinks: 'purchasing:get-supplier-links',
  setSupplierCodes: 'purchasing:set-supplier-codes',
  searchOrderProducts: 'purchasing:search-products',
  suggestOrderProducts: 'purchasing:suggest-products',
  setReorderLevel: 'purchasing:set-reorder-level',
  listOrders: 'purchasing:list-orders',
  getOrder: 'purchasing:get-order',
  saveOrder: 'purchasing:save-order',
  markOrderSent: 'purchasing:mark-sent',
  discardOrder: 'purchasing:discard-order',
  exportOrder: 'purchasing:export-order',
  revealFile: 'purchasing:reveal-file',
} as const;

/**
 * Writes a folio the way it is printed and read aloud.
 *
 * @param folio the number of the order
 * @returns text such as "PED-0007"
 */
export function formatFolio(folio: number): string {
  return `PED-${String(folio).padStart(4, '0')}`;
}
