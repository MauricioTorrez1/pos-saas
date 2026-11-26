import type { StatementSync } from 'node:sqlite';

import { quantityOf, type Unit } from '@pos-saas/money';

import {
  MAX_CART_LINES,
  MAX_PRICE_LIST_ITEMS,
  baseUnitCostE6,
  compareCatalogItems,
  type CartLineRequest,
  type CartProblem,
  type CatalogItem,
  type ComparisonGroup,
  type ColumnMapping,
  type ImportPriceListRequest,
  type ImportPriceListResult,
  type LinkCatalogItemRequest,
  type LinkCatalogItemResult,
  type LinkOrigin,
  type ListCatalogItemsRequest,
  type PriceListPreview,
  type PriceListSource,
  type PriceListSummary,
} from '../../shared/supplier-catalog';
import { buildSynonymIndex, extractFeatures, synonymSearchTexts, type SynonymIndex } from '../../shared/catalog-matching';
import { MAX_ORDER_QUANTITY_MILLI, orderLineCents } from '../../shared/supplier-order';
import type { AuditLog } from '../audit/audit-log';
import type { LocalStore } from '../local-store/local-store';
import { toPrefixQuery } from '../local-store/product-catalog';
import { uuidV7 } from '../uuid-v7';
import { hasAgreedHeaders, locateHeader, missingFields, readPriceListRows, suggestMapping, type PriceListTable } from './price-list-reader';
import type { SupplierService } from './supplier-service';

/** The rows of a file the preview shows. */
const SAMPLE_ROWS = 5;
/** The most items one listing returns. */
const LIST_LIMIT = 500;
/** The rows left out that the summary names one by one. */
const SKIPPED_SHOWN = 50;
/** The most items one comparison looks at. */
const COMPARE_LIMIT = 200;

/** A line of the cart checked against the lists: what was chosen and what was cheapest. */
export interface CartReportLine {
  readonly productId: string;
  readonly productName: string;
  readonly productCode: string | null;
  readonly unit: Unit;
  readonly quantityMilli: number;
  readonly chosen: CatalogItem;
  readonly cheapest: CatalogItem;
  readonly chosenCents: number;
  readonly cheapestCents: number;
}

/** What a supplier gets in the cart. */
export interface CartSupplierShare {
  readonly supplierId: string;
  readonly supplierName: string;
  readonly productCount: number;
  readonly spendCents: number;
}

/** The cart with the prices of the lists of today, worked out in the main process. */
export interface CartReport {
  readonly lines: readonly CartReportLine[];
  readonly totalCents: number;
  /** What the cart would cost buying every line from its cheapest supplier. */
  readonly cheapestTotalCents: number;
  readonly possibleSavingsCents: number;
  readonly suppliers: readonly CartSupplierShare[];
}

export interface ItemRow {
  readonly id: string;
  readonly supplier_id: string;
  readonly supplier_name: string;
  readonly supplier_code: string;
  readonly description: string;
  readonly purchase_unit: string | null;
  readonly pieces_per_unit_milli: number;
  readonly list_cost_e6: number;
  readonly product_id: string | null;
  readonly product_name: string | null;
  readonly product_unit: Unit | null;
  readonly product_barcode: string | null;
  readonly link_origin: LinkOrigin | null;
  readonly list_date: string;
  readonly source: PriceListSource;
  readonly equivalence_group_id: string | null;
  readonly equivalence_name: string | null;
}

interface PendingFile {
  readonly token: string;
  readonly supplierId: string;
  readonly table: PriceListTable;
}

/** The columns every listing of items reads, joined to its supplier and its product. */
export const ITEM_SELECT = `
  SELECT item.id, item.supplier_id, supplier.name AS supplier_name, item.supplier_code, item.description, item.purchase_unit,
    item.pieces_per_unit_milli, item.list_cost_e6, item.product_id, product.name AS product_name, product.base_unit AS product_unit,
    (SELECT code FROM product_barcode WHERE product_barcode.tenant_id = item.tenant_id AND product_barcode.product_id = item.product_id ORDER BY code LIMIT 1) AS product_barcode,
    item.link_origin, item.list_date, item.source, member.group_id AS equivalence_group_id, group_name.name AS equivalence_name
  FROM supplier_catalog_item AS item
  JOIN supplier ON supplier.id = item.supplier_id
  LEFT JOIN product ON product.id = item.product_id
  LEFT JOIN catalog_equivalence_member AS member
    ON member.tenant_id = item.tenant_id AND member.supplier_id = item.supplier_id AND member.supplier_code = item.supplier_code
  LEFT JOIN catalog_equivalence_name AS group_name ON group_name.tenant_id = item.tenant_id AND group_name.group_id = member.group_id
`;

/**
 * Turns a row of the database into an item, with the cost of one base unit worked out.
 *
 * @param row the joined row
 * @returns the item as the screens read it
 */
export function toCatalogItem(row: ItemRow): CatalogItem {
  return {
    id: row.id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    supplierCode: row.supplier_code,
    description: row.description,
    purchaseUnit: row.purchase_unit,
    piecesPerUnitMilli: row.pieces_per_unit_milli,
    listCostE6: row.list_cost_e6,
    baseUnitCostE6: baseUnitCostE6(row.list_cost_e6, row.pieces_per_unit_milli),
    productId: row.product_id,
    productName: row.product_name,
    productUnit: row.product_unit,
    productBarcode: row.product_barcode,
    linkOrigin: row.product_id === null ? null : row.link_origin,
    listDate: row.list_date,
    source: row.source,
    equivalenceGroupId: row.equivalence_group_id,
    equivalenceName: row.equivalence_name,
  };
}

/**
 * Works out the cost per base unit of an item not tied to a product with the pieces its description gives («caja c/100»),
 * when its list said nothing about pieces (E1-63). Items tied to a product keep the pieces of the list, because the cart
 * orders with those.
 *
 * @param item the item as the list has it
 * @param index the synonyms, which do not change the pieces but are needed to read the description
 * @returns the same item, or a copy with the pieces of its description
 */
export function withPiecesFromDescription(item: CatalogItem, index?: SynonymIndex): CatalogItem {
  if (item.productId !== null || item.piecesPerUnitMilli !== 1000) {
    return item;
  }
  const packCount = extractFeatures(item.description, index).packCount;
  if (packCount === null || packCount * 1000 > 100_000_000) {
    return item;
  }
  const piecesPerUnitMilli = packCount * 1000;
  return { ...item, piecesPerUnitMilli, baseUnitCostE6: baseUnitCostE6(item.listCostE6, piecesPerUnitMilli), piecesFromDescription: true };
}

/**
 * The price lists of the suppliers (E1-51, ADR 0068). A list is imported from an Excel or CSV file of one supplier and
 * replaces that supplier's previous list in one transaction. Each item is tied to a product of the store by the code the
 * owner already gave it with that supplier, then by its barcode, and the rest wait for the owner to tie them by hand once:
 * that choice is remembered for the next list. The mapping of the columns is remembered per supplier too. Only the owner
 * reaches it, which the bridge checks, and every import and every link by hand is in the audit log.
 */
export class SupplierCatalogService {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  readonly #audit: Pick<AuditLog, 'record'>;
  readonly #suppliers: Pick<SupplierService, 'find'>;
  #pending: PendingFile | null = null;
  readonly #settingsOf: StatementSync;
  readonly #upsertSettings: StatementSync;
  readonly #deleteItems: StatementSync;
  readonly #insertItem: StatementSync;
  readonly #manualLinkOf: StatementSync;
  readonly #codeLinkOf: StatementSync;
  readonly #barcodeLinkOf: StatementSync;
  readonly #summaryOf: StatementSync;
  readonly #listItems: StatementSync;
  readonly #itemById: StatementSync;
  readonly #productExists: StatementSync;
  readonly #setLink: StatementSync;
  readonly #upsertManualLink: StatementSync;
  readonly #deleteManualLink: StatementSync;
  readonly #searchAll: StatementSync;
  readonly #itemsOfProduct: StatementSync;
  readonly #itemsOfGroup: StatementSync;
  readonly #ownerSynonyms: StatementSync;

  /**
   * @param store the open local database
   * @param tenantId the business
   * @param audit the audit log
   * @param suppliers reads the suppliers
   */
  constructor(store: LocalStore, tenantId: string, audit: Pick<AuditLog, 'record'>, suppliers: Pick<SupplierService, 'find'>) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#audit = audit;
    this.#suppliers = suppliers;
    this.#settingsOf = store.prepare('SELECT column_mapping, costs_include_vat FROM supplier_price_list_settings WHERE tenant_id = ? AND supplier_id = ?');
    this.#upsertSettings = store.prepare(`
      INSERT INTO supplier_price_list_settings (tenant_id, supplier_id, column_mapping, costs_include_vat, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, supplier_id) DO UPDATE SET column_mapping = excluded.column_mapping, costs_include_vat = excluded.costs_include_vat, updated_at = excluded.updated_at
    `);
    this.#deleteItems = store.prepare('DELETE FROM supplier_catalog_item WHERE tenant_id = ? AND supplier_id = ?');
    this.#insertItem = store.prepare(`
      INSERT INTO supplier_catalog_item
        (id, tenant_id, supplier_id, supplier_code, description, purchase_unit, pieces_per_unit_milli, list_cost_e6, product_id, link_origin, list_date, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.#manualLinkOf = store.prepare(`
      SELECT link.product_id FROM supplier_catalog_link AS link JOIN product ON product.id = link.product_id AND product.is_active = 1
      WHERE link.tenant_id = ? AND link.supplier_id = ? AND link.supplier_code = ?
    `);
    this.#codeLinkOf = store.prepare(`
      SELECT code.product_id FROM supplier_product_code AS code JOIN product ON product.id = code.product_id AND product.is_active = 1
      WHERE code.tenant_id = ? AND code.supplier_id = ? AND code.supplier_code = ? ORDER BY product.name LIMIT 1
    `);
    this.#barcodeLinkOf = store.prepare(`
      SELECT barcode.product_id FROM product_barcode AS barcode JOIN product ON product.id = barcode.product_id AND product.is_active = 1
      WHERE barcode.tenant_id = ? AND barcode.code = ?
    `);
    this.#summaryOf = store.prepare(`
      SELECT count(*) AS item_count, count(product_id) AS linked_count, max(list_date) AS list_date, max(source) AS source
      FROM supplier_catalog_item WHERE tenant_id = ? AND supplier_id = ?
    `);
    this.#listItems = store.prepare(`
      ${ITEM_SELECT}
      WHERE item.tenant_id = ? AND item.supplier_id = ? AND (? = 0 OR item.product_id IS NULL)
        AND (? IS NULL OR item.local_rowid IN (SELECT rowid FROM supplier_catalog_search WHERE supplier_catalog_search MATCH ?))
      ORDER BY item.product_id IS NOT NULL, item.description COLLATE NOCASE
      LIMIT ${LIST_LIMIT}
    `);
    this.#itemById = store.prepare(`${ITEM_SELECT} WHERE item.tenant_id = ? AND item.id = ?`);
    this.#productExists = store.prepare('SELECT name FROM product WHERE tenant_id = ? AND id = ?');
    this.#setLink = store.prepare('UPDATE supplier_catalog_item SET product_id = ?, link_origin = ? WHERE tenant_id = ? AND id = ?');
    this.#upsertManualLink = store.prepare(`
      INSERT INTO supplier_catalog_link (tenant_id, supplier_id, supplier_code, product_id, linked_by, linked_at) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, supplier_id, supplier_code) DO UPDATE SET product_id = excluded.product_id, linked_by = excluded.linked_by, linked_at = excluded.linked_at
    `);
    this.#deleteManualLink = store.prepare('DELETE FROM supplier_catalog_link WHERE tenant_id = ? AND supplier_id = ? AND supplier_code = ?');
    this.#searchAll = store.prepare(`
      ${ITEM_SELECT}
      WHERE item.tenant_id = ? AND supplier.is_active = 1
        AND item.local_rowid IN (SELECT rowid FROM supplier_catalog_search WHERE supplier_catalog_search MATCH ?)
      ORDER BY item.description COLLATE NOCASE
      LIMIT ${COMPARE_LIMIT}
    `);
    this.#itemsOfProduct = store.prepare(`${ITEM_SELECT} WHERE item.tenant_id = ? AND item.product_id = ? AND supplier.is_active = 1`);
    this.#itemsOfGroup = store.prepare(`${ITEM_SELECT} WHERE item.tenant_id = ? AND member.group_id = ? AND supplier.is_active = 1`);
    this.#ownerSynonyms = store.prepare('SELECT term, canonical FROM catalog_synonym WHERE tenant_id = ? ORDER BY term');
  }

  /**
   * The dictionary of the matcher: the synonyms of the register and the ones the owner added (E1-63).
   *
   * @returns the index to read descriptions with
   */
  synonymIndex(): SynonymIndex {
    return buildSynonymIndex(this.#ownerSynonyms.all(this.#tenantId) as unknown as { term: string; canonical: string }[]);
  }

  /**
   * Keeps a file that was read until the owner confirms its columns, and says what it holds. Only the last file is kept.
   *
   * @param supplierId the supplier the list is of
   * @param fileName the name of the file, to show it
   * @param cells the rows of the file, as text
   * @returns what the import screen shows, with the columns to start from
   */
  preview(supplierId: string, fileName: string, cells: readonly (readonly string[])[]): PriceListPreview {
    const table = locateHeader(cells);
    const settings = this.#settingsOf.get(this.#tenantId, supplierId) as unknown as { column_mapping: string; costs_include_vat: number } | undefined;
    const remembered = settings === undefined ? null : (JSON.parse(settings.column_mapping) as ColumnMapping);
    const { mapping, origin } = suggestMapping(table.headers, remembered);
    const token = uuidV7();
    this.#pending = { token, supplierId, table };
    return {
      token,
      fileName,
      headers: table.headers,
      sampleRows: table.rows.slice(0, SAMPLE_ROWS).map(({ cells: row }) => row),
      rowCount: table.rows.length,
      mapping,
      mappingOrigin: origin,
      costsIncludeVat: settings?.costs_include_vat === 1,
      source: hasAgreedHeaders(table.headers) ? 'paper' : 'file',
    };
  }

  /**
   * Replaces the list of a supplier with the file kept by `preview`, in one transaction with its audit entry, and
   * remembers the columns and the VAT choice for the next list of the same supplier.
   *
   * @param request the file, the supplier, the columns, the VAT choice, the date and the source of the list
   * @param userId who imports it, the owner
   * @returns the counts, or why nothing changed
   * @throws RangeError if the date is not a day or the file has too many items
   */
  import(request: ImportPriceListRequest, userId: string): ImportPriceListResult {
    const pending = this.#pending;
    if (pending === null || pending.token !== request.token || pending.supplierId !== request.supplierId) {
      return { status: 'expired' };
    }
    const supplier = this.#suppliers.find(request.supplierId);
    if (supplier === null) {
      return { status: 'supplier_not_found' };
    }
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(request.listDate) || Number.isNaN(Date.parse(request.listDate))) {
      throw new RangeError('The date of the list must be a day as YYYY-MM-DD');
    }
    const missing = missingFields(pending.table.headers, request.mapping);
    if (missing.length > 0) {
      return { status: 'missing_columns', fields: missing };
    }
    const { items, skipped } = readPriceListRows(pending.table, request.mapping, request.costsIncludeVat);
    if (items.length === 0) {
      return { status: 'empty', skipped: skipped.slice(0, SKIPPED_SHOWN) };
    }
    if (items.length > MAX_PRICE_LIST_ITEMS) {
      throw new RangeError(`A list has at most ${MAX_PRICE_LIST_ITEMS} items`);
    }
    let linkedCount = 0;
    this.#store.transaction(() => {
      this.#deleteItems.run(this.#tenantId, supplier.id);
      for (const item of items) {
        const link = this.#findLink(supplier.id, item.supplierCode, item.barcode);
        if (link !== null) {
          linkedCount += 1;
        }
        this.#insertItem.run(
          uuidV7(),
          this.#tenantId,
          supplier.id,
          item.supplierCode,
          item.description,
          item.purchaseUnit,
          item.piecesPerUnitMilli,
          item.listCostE6,
          link?.productId ?? null,
          link?.origin ?? null,
          request.listDate,
          request.source,
        );
      }
      this.#upsertSettings.run(this.#tenantId, supplier.id, JSON.stringify(request.mapping), request.costsIncludeVat ? 1 : 0, new Date().toISOString());
      this.#audit.record({
        userId,
        action: 'supplier_price_list.import',
        entity: 'supplier',
        entityId: supplier.id,
        detail: `List of ${supplier.name} of ${request.listDate} from ${request.source === 'paper' ? 'a paper catalog' : 'a file'}: ${items.length} items, ${linkedCount} linked, ${skipped.length} rows left out; costs ${request.costsIncludeVat ? 'included' : 'did not include'} VAT`,
      });
    });
    this.#pending = null;
    return { status: 'imported', summary: { itemCount: items.length, linkedCount, skippedCount: skipped.length, skipped: skipped.slice(0, SKIPPED_SHOWN) } };
  }

  /**
   * Says what list a supplier has now.
   *
   * @param supplierId the supplier
   * @returns its date, source and counts, with a null date when it has none
   */
  summary(supplierId: string): PriceListSummary {
    const row = this.#summaryOf.get(this.#tenantId, supplierId) as unknown as { item_count: number; linked_count: number; list_date: string | null; source: PriceListSource | null };
    return { supplierId, listDate: row.list_date, source: row.source, itemCount: row.item_count, linkedCount: row.linked_count };
  }

  /**
   * Lists the items of a supplier's list, the ones without a product first.
   *
   * @param request the supplier, whether only the items without a product, and words to look for
   * @returns at most 500 items
   */
  list({ supplierId, onlyUnlinked, text }: ListCatalogItemsRequest): CatalogItem[] {
    const query = toPrefixQuery(text);
    const rows = this.#listItems.all(this.#tenantId, supplierId, onlyUnlinked ? 1 : 0, query, query) as unknown as ItemRow[];
    return rows.map(toCatalogItem);
  }

  /**
   * Ties an item to a product by hand, or unties it, and remembers it for the next list of the same supplier. Written in
   * one transaction with its audit entry.
   *
   * @param request the item and the product, or null to untie it
   * @param userId who does it, the owner
   * @returns the item as it is now, or why nothing changed
   */
  link({ itemId, productId }: LinkCatalogItemRequest, userId: string): LinkCatalogItemResult {
    const current = this.#itemById.get(this.#tenantId, itemId) as unknown as ItemRow | undefined;
    if (current === undefined) {
      return { status: 'not_found' };
    }
    const product = productId === null ? null : (this.#productExists.get(this.#tenantId, productId) as unknown as { name: string } | undefined);
    if (product === undefined) {
      return { status: 'product_not_found' };
    }
    this.#store.transaction(() => {
      this.#setLink.run(productId, productId === null ? null : 'manual', this.#tenantId, itemId);
      if (productId === null) {
        this.#deleteManualLink.run(this.#tenantId, current.supplier_id, current.supplier_code);
      } else {
        this.#upsertManualLink.run(this.#tenantId, current.supplier_id, current.supplier_code, productId, userId, new Date().toISOString());
      }
      this.#audit.record({
        userId,
        action: productId === null ? 'supplier_catalog.unlink' : 'supplier_catalog.link',
        entity: 'supplier',
        entityId: current.supplier_id,
        detail:
          product === null
            ? `${current.supplier_name} ${current.supplier_code} (${current.description}) untied from ${current.product_name ?? 'nothing'}`
            : `${current.supplier_name} ${current.supplier_code} (${current.description}) tied to ${product.name}`,
      });
    });
    return { status: 'linked', item: toCatalogItem(this.#itemById.get(this.#tenantId, itemId) as unknown as ItemRow) };
  }

  /**
   * Compares what every active supplier asks for the items that match the words (E1-52). A product that matched brings
   * every item tied to it, even the ones of another supplier described with other words, so the comparison is complete.
   * Since E1-63 the words are also searched with their synonyms («alta velocidad» finds «HSS»), an item in a group of
   * equivalent products brings the whole group, and an item without a product is compared with the pieces its description
   * gives when its list gave none.
   *
   * @param text words of the description or the code, without caring about accents
   * @returns the groups by product or by equivalent products, the cheapest option first
   */
  compare(text: string): ComparisonGroup[] {
    const index = this.synonymIndex();
    const found = new Map<string, CatalogItem>();
    for (const words of [text, ...synonymSearchTexts(text, index)]) {
      const query = toPrefixQuery(words);
      if (query === null) {
        continue;
      }
      for (const row of this.#searchAll.all(this.#tenantId, query) as unknown as ItemRow[]) {
        found.set(row.id, toCatalogItem(row));
      }
    }
    const products = new Set([...found.values()].map((item) => item.productId).filter((id): id is string => id !== null));
    for (const productId of products) {
      for (const item of this.#optionsOf(productId)) {
        found.set(item.id, item);
      }
    }
    const groups = new Set([...found.values()].map((item) => item.equivalenceGroupId ?? null).filter((id): id is string => id !== null));
    for (const groupId of groups) {
      for (const row of this.#itemsOfGroup.all(this.#tenantId, groupId) as unknown as ItemRow[]) {
        found.set(row.id, toCatalogItem(row));
      }
    }
    return compareCatalogItems([...found.values()].map((item) => withPiecesFromDescription(item, index)));
  }

  /**
   * Checks a cart against today's lists and works out every amount in the main process, so a screen cannot send its own
   * prices. Each line needs an item tied to its product and a whole quantity of its unit.
   *
   * @param lines the lines of the cart
   * @returns the report with the cheapest option of each line and what each supplier gets, or what is wrong
   */
  cartReport(lines: readonly CartLineRequest[]): CartReport | CartProblem {
    if (lines.length === 0) {
      return { status: 'empty' };
    }
    if (lines.length > MAX_CART_LINES) {
      throw new RangeError(`A cart has at most ${MAX_CART_LINES} lines`);
    }
    const report: CartReportLine[] = [];
    for (const line of lines) {
      const row = this.#itemById.get(this.#tenantId, line.itemId) as unknown as ItemRow | undefined;
      if (row === undefined) {
        return { status: 'item_not_found', itemId: line.itemId };
      }
      const chosen = toCatalogItem(row);
      if (chosen.productId !== line.productId || chosen.productName === null || chosen.productUnit === null) {
        return { status: 'item_mismatch', productId: line.productId };
      }
      if (!Number.isSafeInteger(line.quantityMilli) || line.quantityMilli <= 0 || line.quantityMilli > MAX_ORDER_QUANTITY_MILLI || !isWholeQuantity(line.quantityMilli, chosen.productUnit)) {
        return { status: 'bad_quantity', productId: line.productId };
      }
      const cheapest = this.#optionsOf(line.productId).reduce((best, item) => (item.baseUnitCostE6 < best.baseUnitCostE6 ? item : best), chosen);
      report.push({
        productId: line.productId,
        productName: chosen.productName,
        productCode: chosen.productBarcode,
        unit: chosen.productUnit,
        quantityMilli: line.quantityMilli,
        chosen,
        cheapest,
        chosenCents: orderLineCents(chosen.baseUnitCostE6, line.quantityMilli),
        cheapestCents: orderLineCents(cheapest.baseUnitCostE6, line.quantityMilli),
      });
    }
    const shares = new Map<string, CartSupplierShare>();
    for (const line of report) {
      const share = shares.get(line.chosen.supplierId) ?? { supplierId: line.chosen.supplierId, supplierName: line.chosen.supplierName, productCount: 0, spendCents: 0 };
      shares.set(line.chosen.supplierId, { ...share, productCount: share.productCount + 1, spendCents: share.spendCents + line.chosenCents });
    }
    const totalCents = report.reduce((total, line) => total + line.chosenCents, 0);
    const cheapestTotalCents = report.reduce((total, line) => total + line.cheapestCents, 0);
    return {
      lines: report,
      totalCents,
      cheapestTotalCents,
      possibleSavingsCents: totalCents - cheapestTotalCents,
      suppliers: [...shares.values()].sort((left, right) => right.spendCents - left.spendCents),
    };
  }

  #optionsOf(productId: string): CatalogItem[] {
    return (this.#itemsOfProduct.all(this.#tenantId, productId) as unknown as ItemRow[]).map(toCatalogItem);
  }

  /** The link of an item: what the owner chose before, then the code given to a product with this supplier, then the barcode. */
  #findLink(supplierId: string, supplierCode: string, barcode: string | null): { productId: string; origin: LinkOrigin } | null {
    const manual = this.#manualLinkOf.get(this.#tenantId, supplierId, supplierCode) as unknown as { product_id: string } | undefined;
    if (manual !== undefined) {
      return { productId: manual.product_id, origin: 'manual' };
    }
    const byCode = this.#codeLinkOf.get(this.#tenantId, supplierId, supplierCode) as unknown as { product_id: string } | undefined;
    if (byCode !== undefined) {
      return { productId: byCode.product_id, origin: 'supplier_code' };
    }
    for (const candidate of [barcode, supplierCode]) {
      if (candidate === null) {
        continue;
      }
      const byBarcode = this.#barcodeLinkOf.get(this.#tenantId, candidate) as unknown as { product_id: string } | undefined;
      if (byBarcode !== undefined) {
        return { productId: byBarcode.product_id, origin: 'barcode' };
      }
    }
    return null;
  }
}

function isWholeQuantity(quantityMilli: number, unit: Unit): boolean {
  try {
    quantityOf(quantityMilli, unit);
    return true;
  } catch {
    return false;
  }
}
