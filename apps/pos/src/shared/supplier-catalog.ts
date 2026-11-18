import type { Unit } from '@pos-saas/money';

import { readUnitCost } from './product-admin';

/** The columns a price list can bring. The first three are required. */
export const PRICE_LIST_FIELDS = ['supplierCode', 'description', 'cost', 'purchaseUnit', 'piecesPerUnit', 'barcode'] as const;
export type PriceListField = (typeof PRICE_LIST_FIELDS)[number];
export const REQUIRED_PRICE_LIST_FIELDS: readonly PriceListField[] = ['supplierCode', 'description', 'cost'];

/** How each field reads on the import screen. */
export const PRICE_LIST_FIELD_LABELS: Readonly<Record<PriceListField, string>> = {
  supplierCode: 'Código del proveedor',
  description: 'Descripción',
  cost: 'Costo',
  purchaseUnit: 'Presentación (opcional)',
  piecesPerUnit: 'Piezas por presentación (opcional)',
  barcode: 'Código de barras (opcional)',
};

/**
 * The header of the CSV that E1-53 writes from a paper catalog, agreed between both tasks. A file with these headers is
 * read without asking for the columns.
 */
export const AGREED_PRICE_LIST_HEADERS: Readonly<Partial<Record<PriceListField, string>>> = {
  supplierCode: 'supplier_code',
  description: 'description',
  purchaseUnit: 'purchase_unit',
  piecesPerUnit: 'pieces_per_unit',
  cost: 'cost',
};

/** Which header of the file each field comes from. A field that is left out is not in the file. */
export type ColumnMapping = Partial<Record<PriceListField, string>>;

/** Where a list came from: a file of the supplier, or a paper catalog read by Claude (E1-53). */
export type PriceListSource = 'file' | 'paper';

/** How an item was tied to a product of the store. */
export type LinkOrigin = 'supplier_code' | 'barcode' | 'manual';

/** The most items one list may have. */
export const MAX_PRICE_LIST_ITEMS = 20_000;
/** The longest description of an item. */
export const MAX_ITEM_DESCRIPTION_LENGTH = 200;
/** The most pieces one purchase unit may hold, in thousandths: 100,000 pieces. */
export const MAX_PIECES_PER_UNIT_MILLI = 100_000_000;

/** What the screen shows of a file before it is imported. */
export interface PriceListPreview {
  /** Names the file kept in the main process until it is imported or another one is chosen. */
  readonly token: string;
  readonly fileName: string;
  readonly headers: readonly string[];
  /** The first rows under the header, so the owner sees what each column holds. */
  readonly sampleRows: readonly (readonly string[])[];
  readonly rowCount: number;
  /** The mapping to start from. */
  readonly mapping: ColumnMapping;
  /** Where that mapping came from: the last list of this supplier, the agreed header of E1-53, or a guess by the names. */
  readonly mappingOrigin: 'remembered' | 'agreed' | 'guessed';
  readonly costsIncludeVat: boolean;
  readonly source: PriceListSource;
}

export type PickPriceListResult =
  | { readonly status: 'picked'; readonly preview: PriceListPreview }
  | { readonly status: 'cancelled' }
  | { readonly status: 'unreadable'; readonly message: string };

/** What the owner confirms to import a list. */
export interface ImportPriceListRequest {
  readonly token: string;
  readonly supplierId: string;
  readonly mapping: ColumnMapping;
  readonly costsIncludeVat: boolean;
  /** The day of the list, as YYYY-MM-DD. */
  readonly listDate: string;
  readonly source: PriceListSource;
}

/** A row of the file that was left out, and why, in Spanish for the owner. */
export interface SkippedPriceRow {
  /** The row as Excel numbers it, from 1. */
  readonly rowNumber: number;
  readonly reason: string;
}

export interface PriceListImportSummary {
  readonly itemCount: number;
  readonly linkedCount: number;
  readonly skippedCount: number;
  /** The first rows that were left out. */
  readonly skipped: readonly SkippedPriceRow[];
}

export type ImportPriceListResult =
  | { readonly status: 'imported'; readonly summary: PriceListImportSummary }
  /** The file is no longer in memory: choose it again. */
  | { readonly status: 'expired' }
  | { readonly status: 'supplier_not_found' }
  | { readonly status: 'missing_columns'; readonly fields: readonly PriceListField[] }
  /** No row could be read, so the previous list was kept. */
  | { readonly status: 'empty'; readonly skipped: readonly SkippedPriceRow[] };

/** An item of a supplier's list, with its cost per base unit already worked out. */
export interface CatalogItem {
  readonly id: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly supplierCode: string;
  readonly description: string;
  readonly purchaseUnit: string | null;
  readonly piecesPerUnitMilli: number;
  /** The cost of one purchase unit before VAT, in millionths of a peso. */
  readonly listCostE6: number;
  /** The cost of one base unit of the product before VAT, in millionths of a peso. */
  readonly baseUnitCostE6: number;
  readonly productId: string | null;
  readonly productName: string | null;
  readonly productUnit: Unit | null;
  /** The first barcode of the linked product. */
  readonly productBarcode: string | null;
  readonly linkOrigin: LinkOrigin | null;
  readonly listDate: string;
  readonly source: PriceListSource;
}

/** The current list of a supplier. */
export interface PriceListSummary {
  readonly supplierId: string;
  /** Null when the supplier has no list yet. */
  readonly listDate: string | null;
  readonly source: PriceListSource | null;
  readonly itemCount: number;
  readonly linkedCount: number;
}

export interface ListCatalogItemsRequest {
  readonly supplierId: string;
  /** Only the items that are not tied to a product. */
  readonly onlyUnlinked: boolean;
  /** Words of the description or the code; empty lists everything. */
  readonly text: string;
}

/** Ties an item to a product, or unties it with null. It is remembered for the next list of the same supplier. */
export interface LinkCatalogItemRequest {
  readonly itemId: string;
  readonly productId: string | null;
}

export type LinkCatalogItemResult =
  | { readonly status: 'linked'; readonly item: CatalogItem }
  | { readonly status: 'not_found' }
  | { readonly status: 'product_not_found' };

/** The price lists of the suppliers (E1-51). Every channel is for the owner. */
export interface SupplierCatalogApi {
  pickPriceList(supplierId: string): Promise<PickPriceListResult>;
  importPriceList(request: ImportPriceListRequest): Promise<ImportPriceListResult>;
  priceListSummary(supplierId: string): Promise<PriceListSummary>;
  listCatalogItems(request: ListCatalogItemsRequest): Promise<CatalogItem[]>;
  linkCatalogItem(request: LinkCatalogItemRequest): Promise<LinkCatalogItemResult>;
}

export const SUPPLIER_CATALOG_CHANNELS = {
  pickPriceList: 'supplier-catalog:pick',
  importPriceList: 'supplier-catalog:import',
  priceListSummary: 'supplier-catalog:summary',
  listCatalogItems: 'supplier-catalog:list',
  linkCatalogItem: 'supplier-catalog:link',
} as const;

const THOUSANDTHS = 1000n;
const VAT_PERCENT = 116n;

/**
 * Works out the cost of one base unit of the product from the cost of the purchase unit, rounded half up. A box of 12 at
 * $120.00 costs $10.00 per piece. Integers only.
 *
 * @param listCostE6 the cost of the purchase unit in millionths of a peso
 * @param piecesPerUnitMilli the base units in it, in thousandths
 * @returns the cost per base unit in millionths of a peso
 * @throws RangeError if a value is not a whole number or the pieces are not above zero
 */
export function baseUnitCostE6(listCostE6: number, piecesPerUnitMilli: number): number {
  if (!Number.isSafeInteger(listCostE6) || listCostE6 < 0 || !Number.isSafeInteger(piecesPerUnitMilli) || piecesPerUnitMilli <= 0) {
    throw new RangeError('The cost must be a whole number of zero or more and the pieces above zero');
  }
  const pieces = BigInt(piecesPerUnitMilli);
  return Number((BigInt(listCostE6) * THOUSANDTHS * 2n + pieces) / (pieces * 2n));
}

/**
 * Takes the VAT of 16 % out of a cost that includes it, rounded half up. Mexico's general rate is the one a hardware store
 * pays on almost everything it buys (ADR 0068).
 *
 * @param costE6 a cost with VAT in millionths of a peso
 * @returns the cost before VAT
 */
export function removeVat(costE6: number): number {
  return Number((BigInt(costE6) * 200n + VAT_PERCENT) / (VAT_PERCENT * 2n));
}

/**
 * Reads a cost as suppliers write it: "$1,234.50", "58.25" or " 12 ". Up to 6 decimals.
 *
 * @param text the cell
 * @returns the cost in millionths of a peso, or the reason it cannot be read
 */
export function readListCost(text: string): { readonly ok: true; readonly costE6: number } | { readonly ok: false; readonly reason: string } {
  const cleaned = text.replace(/[$\s]/gu, '').replace(/,(?=\d{3}(\D|$))/gu, '');
  if (cleaned === '') {
    return { ok: false, reason: 'No trae costo.' };
  }
  const reading = readUnitCost(cleaned);
  return reading.ok ? { ok: true, costE6: reading.unitCostE6 } : { ok: false, reason: reading.message };
}

/**
 * Reads how many base units come in a purchase unit. Empty means one.
 *
 * @param text the cell
 * @returns the quantity in thousandths, or the reason it cannot be read
 */
export function readPiecesPerUnit(text: string): { readonly ok: true; readonly milli: number } | { readonly ok: false; readonly reason: string } {
  const cleaned = text.trim().replace(/,/gu, '');
  if (cleaned === '') {
    return { ok: true, milli: 1000 };
  }
  const match = /^(\d+)(?:\.(\d{1,3}))?$/u.exec(cleaned);
  if (match === null) {
    return { ok: false, reason: 'Las piezas por presentación deben ser un número con hasta 3 decimales.' };
  }
  const milli = Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
  if (milli <= 0 || milli > MAX_PIECES_PER_UNIT_MILLI) {
    return { ok: false, reason: 'Las piezas por presentación deben ser más de cero y hasta 100,000.' };
  }
  return { ok: true, milli };
}

/**
 * Makes two headers comparable: no accents, capitals, spaces at the ends or repeated inside.
 *
 * @param header the text of a header cell
 * @returns the header as it is compared
 */
export function normalizeHeader(header: string): string {
  return header
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}
