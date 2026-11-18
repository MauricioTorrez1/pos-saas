import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';

import type { UserSummary } from '../../shared/auth';
import {
  PRICE_LIST_FIELDS,
  SUPPLIER_CATALOG_CHANNELS,
  type CatalogItem,
  type ColumnMapping,
  type ImportPriceListRequest,
  type ImportPriceListResult,
  type LinkCatalogItemRequest,
  type LinkCatalogItemResult,
  type ListCatalogItemsRequest,
  type PickPriceListResult,
  type PriceListSummary,
} from '../../shared/supplier-catalog';
import { parseCsv } from '../import/eleventa-csv';
import { readXlsxTable, WorkbookError } from '../import/xlsx-reader';
import { parseProductId } from '../inventory/inventory-request';
import { parseUuid } from './purchasing-request';
import type { SupplierCatalogService } from './supplier-catalog-service';

/** A supplier's list is never this big; a bigger file is refused before it is read. */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** The longest text the bridge takes in a field. */
const MAX_FIELD_LENGTH = 200;
/** Costs keep up to six decimals (ADR 0011), so Excel's noise is rounded there. */
const COST_DECIMALS = 6;

export interface SupplierCatalogServices {
  readonly catalog: SupplierCatalogService;
  /** Opens the window of Windows to choose a file, or answers null when the person closes it. */
  readonly pickFile: (title: string) => Promise<string | null>;
}

export type AnswerSignedInWithUser = <Result>(channel: string, respond: (argument: unknown, user: UserSummary) => Result) => void;

function asRecord(value: unknown, description: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`Expected ${description}`);
  }
  return value as Record<string, unknown>;
}

function requireText(value: unknown, description: string): string {
  if (typeof value !== 'string' || value.length > MAX_FIELD_LENGTH) {
    throw new TypeError(`Expected ${description} as text of at most ${MAX_FIELD_LENGTH} characters`);
  }
  return value;
}

/**
 * Checks the columns the owner chose: only known fields, each one a header text.
 *
 * @param value what the screen sent
 * @returns the mapping
 * @throws TypeError if it is not shaped as one
 */
export function parseColumnMapping(value: unknown): ColumnMapping {
  const record = asRecord(value, 'the columns of the list');
  const mapping: ColumnMapping = {};
  for (const [field, header] of Object.entries(record)) {
    if (!(PRICE_LIST_FIELDS as readonly string[]).includes(field)) {
      throw new TypeError(`Unknown field ${field}`);
    }
    if (header !== undefined && header !== null) {
      mapping[field as keyof ColumnMapping] = requireText(header, 'a header');
    }
  }
  return mapping;
}

/**
 * Checks an import request that came over the bridge.
 *
 * @param value what the screen sent
 * @returns the request
 * @throws TypeError if something is missing or has the wrong type
 */
export function parseImportPriceListRequest(value: unknown): ImportPriceListRequest {
  const request = asRecord(value, 'an import of a price list');
  if (typeof request.costsIncludeVat !== 'boolean') {
    throw new TypeError('Expected whether the costs include VAT');
  }
  if (request.source !== 'file' && request.source !== 'paper') {
    throw new TypeError('Expected the source of the list as file or paper');
  }
  return {
    token: parseUuid(request.token, 'the file'),
    supplierId: parseUuid(request.supplierId, 'a supplier'),
    mapping: parseColumnMapping(request.mapping),
    costsIncludeVat: request.costsIncludeVat,
    listDate: requireText(request.listDate, 'the date of the list'),
    source: request.source,
  };
}

/**
 * Checks a listing request.
 *
 * @param value what the screen sent
 * @returns the request
 * @throws TypeError if it is not shaped as one
 */
export function parseListCatalogItemsRequest(value: unknown): ListCatalogItemsRequest {
  const request = asRecord(value, 'a listing of a price list');
  if (typeof request.onlyUnlinked !== 'boolean') {
    throw new TypeError('Expected whether to list only the items without a product');
  }
  return { supplierId: parseUuid(request.supplierId, 'a supplier'), onlyUnlinked: request.onlyUnlinked, text: requireText(request.text, 'words to look for') };
}

/**
 * Checks a link request.
 *
 * @param value what the screen sent
 * @returns the request
 * @throws TypeError if it is not shaped as one
 */
export function parseLinkCatalogItemRequest(value: unknown): LinkCatalogItemRequest {
  const request = asRecord(value, 'a link of an item');
  return {
    itemId: parseUuid(request.itemId, 'an item'),
    productId: request.productId === null ? null : parseProductId(request.productId),
  };
}

function decode(bytes: Buffer): string {
  const utf8 = bytes.toString('utf8');
  return utf8.includes('�') ? bytes.toString('latin1') : utf8;
}

/**
 * Reads a price list file as a table of text: a workbook when it starts as a zip, otherwise a CSV.
 *
 * @param path the file
 * @returns the rows, or the reason in Spanish for the owner
 */
export function readPriceListFile(path: string): { ok: true; table: string[][] } | { ok: false; message: string } {
  try {
    if (statSync(path).size > MAX_FILE_BYTES) {
      return { ok: false, message: 'El archivo es demasiado grande para ser una lista de precios.' };
    }
    const bytes = readFileSync(path);
    // A workbook is a zip, and every zip starts with the letters PK, whatever the file is called.
    const table = bytes.subarray(0, 2).toString('latin1') === 'PK' ? readXlsxTable(bytes, COST_DECIMALS) : parseCsv(decode(bytes));
    return { ok: true, table };
  } catch (error) {
    if (error instanceof WorkbookError) {
      return { ok: false, message: error.message };
    }
    return { ok: false, message: 'No se pudo leer el archivo. Revisa que no esté abierto en otro programa.' };
  }
}

/**
 * Registers the channels of the supplier price lists (E1-51). Every one is for the owner, because the lists carry the
 * costs of the business.
 *
 * @param answerSignedIn registers a channel that needs a person signed in
 * @param refuse builds the error for a person who may not do something
 * @param services the price lists and the window to choose a file
 */
export function registerSupplierCatalogHandlers(answerSignedIn: AnswerSignedInWithUser, refuse: (message: string) => Error, { catalog, pickFile }: SupplierCatalogServices): void {
  const answerOwner = <Result>(channel: string, respond: (argument: unknown, user: UserSummary) => Result): void =>
    answerSignedIn(channel, (argument, user) => {
      if (user.role !== 'owner') {
        throw refuse('Only the owner sees the price lists of the suppliers');
      }
      return respond(argument, user);
    });
  answerOwner(SUPPLIER_CATALOG_CHANNELS.pickPriceList, async (value): Promise<PickPriceListResult> => {
    const supplierId = parseUuid(value, 'a supplier');
    const path = await pickFile('Elige la lista de precios del proveedor (Excel .xlsx o CSV)');
    if (path === null) {
      return { status: 'cancelled' };
    }
    const reading = readPriceListFile(path);
    if (!reading.ok) {
      return { status: 'unreadable', message: reading.message };
    }
    if (reading.table.length < 2) {
      return { status: 'unreadable', message: 'El archivo no trae renglones debajo del encabezado.' };
    }
    return { status: 'picked', preview: catalog.preview(supplierId, basename(path), reading.table) };
  });
  answerOwner(SUPPLIER_CATALOG_CHANNELS.importPriceList, (value, user): ImportPriceListResult => catalog.import(parseImportPriceListRequest(value), user.id));
  answerOwner(SUPPLIER_CATALOG_CHANNELS.priceListSummary, (value): PriceListSummary => catalog.summary(parseUuid(value, 'a supplier')));
  answerOwner(SUPPLIER_CATALOG_CHANNELS.listCatalogItems, (value): CatalogItem[] => catalog.list(parseListCatalogItemsRequest(value)));
  answerOwner(SUPPLIER_CATALOG_CHANNELS.linkCatalogItem, (value, user): LinkCatalogItemResult => catalog.link(parseLinkCatalogItemRequest(value), user.id));
}
