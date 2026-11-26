import type { Unit } from '@pos-saas/money';

import type { EquivalenceApi } from './catalog-equivalence';
import { readUnitCost } from './product-admin';
import type { OwnerRefusalResult } from './supplier-order';

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
  /** The approved group of equivalent products of other suppliers it belongs to (E1-63), if any. */
  readonly equivalenceGroupId?: string | null;
  readonly equivalenceName?: string | null;
  /**
   * True when the list said nothing about pieces but the description did («caja c/100»), so the cost per base unit was
   * worked out with the pieces of the description. Only for items not tied to a product, which cannot be ordered.
   */
  readonly piecesFromDescription?: boolean;
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

/** One supplier's offer for a product, against the cheapest of its group. */
export interface ComparisonOption {
  readonly item: CatalogItem;
  readonly isCheapest: boolean;
  readonly isMostExpensive: boolean;
  /** How much more than the cheapest one base unit costs, in millionths of a peso. */
  readonly differenceE6: number;
  /** The same difference in hundredths of a percent, or null when the cheapest costs nothing. */
  readonly differenceBp: number | null;
}

/**
 * The offers for one product, the cheapest first. Items tied to the same product, or approved as equivalent products
 * (E1-63), compare together; the items without either form one group of their own.
 */
export interface ComparisonGroup {
  /** The product of the store the group can be ordered as; null when no item of it is tied to a product. */
  readonly productId: string | null;
  readonly productName: string | null;
  readonly productUnit: Unit | null;
  /** The approved group of equivalent products, when the group comes from one. */
  readonly equivalenceGroupId: string | null;
  readonly equivalenceName: string | null;
  readonly options: readonly ComparisonOption[];
}

/** A line of the comparator's cart: a product, how much, and the item of the supplier chosen for it. */
export interface CartLineRequest {
  readonly productId: string;
  /** In thousandths of the base unit of the product. */
  readonly quantityMilli: number;
  readonly itemId: string;
}

export interface CartRequest {
  readonly lines: readonly CartLineRequest[];
}

/** A draft order the cart became. */
export interface CreatedOrder {
  readonly orderId: string;
  readonly folio: number;
  readonly supplierName: string;
  readonly lineCount: number;
  readonly totalCents: number;
}

/** Why a cart cannot be used. */
export type CartProblem =
  | { readonly status: 'empty' }
  | { readonly status: 'item_not_found'; readonly itemId: string }
  /** The chosen item is not tied to the product of the line. */
  | { readonly status: 'item_mismatch'; readonly productId: string }
  | { readonly status: 'bad_quantity'; readonly productId: string };

export type ConfirmCartResult =
  | { readonly status: 'created'; readonly orders: readonly CreatedOrder[] }
  /** Some orders were saved before one failed. */
  | { readonly status: 'partial'; readonly orders: readonly CreatedOrder[]; readonly failedSupplier: string }
  | CartProblem
  | OwnerRefusalResult;

export type ExportCartResult =
  | { readonly status: 'saved'; readonly path: string }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly message: string }
  | CartProblem;

/** The price lists of the suppliers (E1-51) and the comparator (E1-52). Every channel is for the owner. */
export interface SupplierCatalogApi {
  pickPriceList(supplierId: string): Promise<PickPriceListResult>;
  importPriceList(request: ImportPriceListRequest): Promise<ImportPriceListResult>;
  priceListSummary(supplierId: string): Promise<PriceListSummary>;
  listCatalogItems(request: ListCatalogItemsRequest): Promise<CatalogItem[]>;
  linkCatalogItem(request: LinkCatalogItemRequest): Promise<LinkCatalogItemResult>;
  /** Every supplier's items that match the words, grouped by product. */
  compareItems(text: string): Promise<ComparisonGroup[]>;
  /** Splits the cart into one draft order per supplier. */
  confirmCart(request: CartRequest): Promise<ConfirmCartResult>;
  /** Saves the PDF of the cart with the cheapest option of each line and two charts. */
  exportCartPdf(request: CartRequest): Promise<ExportCartResult>;
  /** The equivalent products across catalogs (E1-63), when the register offers them. */
  readonly equivalences?: EquivalenceApi;
}

export const SUPPLIER_CATALOG_CHANNELS = {
  pickPriceList: 'supplier-catalog:pick',
  importPriceList: 'supplier-catalog:import',
  priceListSummary: 'supplier-catalog:summary',
  listCatalogItems: 'supplier-catalog:list',
  linkCatalogItem: 'supplier-catalog:link',
  compareItems: 'supplier-catalog:compare',
  confirmCart: 'supplier-catalog:confirm-cart',
  exportCartPdf: 'supplier-catalog:export-cart',
} as const;

/** The most lines the comparator's cart may have. */
export const MAX_CART_LINES = 200;

function optionsOf(items: readonly CatalogItem[]): ComparisonOption[] {
  const sorted = [...items].sort((left, right) => left.baseUnitCostE6 - right.baseUnitCostE6 || left.supplierName.localeCompare(right.supplierName));
  const lowest = sorted[0]?.baseUnitCostE6 ?? 0;
  const highest = sorted[sorted.length - 1]?.baseUnitCostE6 ?? 0;
  const differs = sorted.length > 1 && highest > lowest;
  return sorted.map((item) => {
    const differenceE6 = item.baseUnitCostE6 - lowest;
    return {
      item,
      isCheapest: differs && item.baseUnitCostE6 === lowest,
      isMostExpensive: differs && item.baseUnitCostE6 === highest,
      differenceE6,
      differenceBp: lowest === 0 ? null : Number((BigInt(differenceE6) * 20_000n + BigInt(lowest)) / (BigInt(lowest) * 2n)),
    };
  });
}

/** The key that puts together the items of one comparison group: their equivalence group, else their product. */
function groupingKeys(items: readonly CatalogItem[]): Map<string, string> {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    const next = parent.get(key) ?? key;
    if (next === key) {
      return key;
    }
    const root = find(next);
    parent.set(key, root);
    return root;
  };
  const union = (left: string, right: string): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parent.set(rightRoot, leftRoot);
    }
  };
  for (const item of items) {
    const own = `i:${item.id}`;
    if (item.productId !== null) {
      union(`p:${item.productId}`, own);
    }
    if (item.equivalenceGroupId !== undefined && item.equivalenceGroupId !== null) {
      union(`g:${item.equivalenceGroupId}`, own);
    }
  }
  return new Map(items.map((item) => [item.id, item.productId === null && (item.equivalenceGroupId ?? null) === null ? 'unlinked' : find(`i:${item.id}`)]));
}

/** The product a group is ordered as: the one most of its items are tied to. */
function mainProductOf(group: readonly CatalogItem[]): CatalogItem | undefined {
  const counts = new Map<string, number>();
  for (const item of group) {
    if (item.productId !== null) {
      counts.set(item.productId, (counts.get(item.productId) ?? 0) + 1);
    }
  }
  const best = [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0];
  return group.find((item) => item.productId === best);
}

/**
 * Groups the items of several suppliers by the product they are tied to, or by the group of equivalent products the owner
 * approved (E1-63), and compares them in the base unit, so a box of 12 and a single piece compare per piece. The cheapest
 * is marked, and so is the most expensive, only when the prices differ. The items without a product or a group form the
 * last group, compared among themselves.
 *
 * @param items the items found
 * @returns the groups by name, each one with the cheapest option first
 */
export function compareCatalogItems(items: readonly CatalogItem[]): ComparisonGroup[] {
  const keys = groupingKeys(items);
  const byKey = new Map<string, CatalogItem[]>();
  for (const item of items) {
    const key = keys.get(item.id) ?? 'unlinked';
    byKey.set(key, [...(byKey.get(key) ?? []), item]);
  }
  return [...byKey.entries()]
    .map(([key, group]) => {
      const product = key === 'unlinked' ? undefined : mainProductOf(group);
      const equivalent = group.find((item) => (item.equivalenceGroupId ?? null) !== null);
      return {
        productId: product?.productId ?? null,
        productName: product?.productName ?? null,
        productUnit: product?.productUnit ?? null,
        equivalenceGroupId: equivalent?.equivalenceGroupId ?? null,
        equivalenceName: equivalent?.equivalenceName ?? null,
        options: optionsOf(group),
      };
    })
    .sort((left, right) => {
      const leftUnlinked = left.productId === null && left.equivalenceGroupId === null;
      const rightUnlinked = right.productId === null && right.equivalenceGroupId === null;
      return Number(leftUnlinked) - Number(rightUnlinked) || (left.productName ?? left.equivalenceName ?? '').localeCompare(right.productName ?? right.equivalenceName ?? '');
    });
}

/**
 * Writes a difference in hundredths of a percent as people read it, with one decimal.
 *
 * @param basisPoints the difference, such as 1250 for 12.5 %
 * @returns text such as "12.5 %"
 */
export function percentText(basisPoints: number): string {
  const tenths = Math.round(basisPoints / 10);
  const fraction = tenths % 10;
  return `${Math.floor(tenths / 10)}${fraction === 0 ? '' : `.${fraction}`} %`;
}

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

/**
 * Writes a quantity in thousandths without decimal numbers: 12000 is "12" and 2500 is "2.5".
 *
 * @param milli the quantity in thousandths
 * @returns the text
 */
export function milliText(milli: number): string {
  const fraction = String(milli % 1000).padStart(3, '0').replace(/0+$/u, '');
  return `${Math.floor(milli / 1000)}${fraction === '' ? '' : `.${fraction}`}`;
}
