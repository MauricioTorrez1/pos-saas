import {
  AGREED_PRICE_LIST_HEADERS,
  MAX_ITEM_DESCRIPTION_LENGTH,
  PRICE_LIST_FIELDS,
  REQUIRED_PRICE_LIST_FIELDS,
  normalizeHeader,
  readListCost,
  readPiecesPerUnit,
  removeVat,
  type ColumnMapping,
  type PriceListField,
  type SkippedPriceRow,
} from '../../shared/supplier-catalog';
import { MAX_PURCHASE_UNIT_LENGTH, MAX_SUPPLIER_CODE_LENGTH } from '../../shared/supplier-order';

/** The header is looked for in the first rows, because many lists start with the name of the supplier and a date. */
const HEADER_SEARCH_ROWS = 15;

/** The words a supplier uses in its headers for each field, without accents or capitals. */
const HEADER_SYNONYMS: Readonly<Record<PriceListField, readonly string[]>> = {
  supplierCode: ['supplier_code', 'codigo', 'clave', 'sku', 'cod', 'codigo proveedor', 'clave proveedor', 'modelo', 'numero de parte', 'no. parte', 'referencia'],
  description: ['description', 'descripcion', 'producto', 'articulo', 'nombre', 'concepto'],
  cost: ['cost', 'costo', 'precio', 'precio lista', 'precio de lista', 'p. lista', 'precio unitario', 'importe', 'precio neto', 'costo unitario'],
  purchaseUnit: ['purchase_unit', 'unidad', 'presentacion', 'empaque', 'um', 'u.m.', 'unidad de medida'],
  piecesPerUnit: ['pieces_per_unit', 'piezas', 'contenido', 'piezas por caja', 'pzas', 'cantidad por empaque', 'factor'],
  barcode: ['barcode', 'codigo de barras', 'barras', 'ean', 'upc', 'cb', 'cod. barras'],
};

/** A table read from the file, with the row that holds the header found. */
export interface PriceListTable {
  readonly headers: readonly string[];
  /** The rows under the header, with the number Excel gives each one. */
  readonly rows: readonly { readonly rowNumber: number; readonly cells: readonly string[] }[];
}

/** An item read from a row, ready to be written. */
export interface PriceListRow {
  readonly rowNumber: number;
  readonly supplierCode: string;
  readonly description: string;
  readonly purchaseUnit: string | null;
  readonly piecesPerUnitMilli: number;
  /** Before VAT, whatever the file said. */
  readonly listCostE6: number;
  readonly barcode: string | null;
}

/** What reading the rows with a mapping gave. */
export interface PriceListReading {
  readonly items: readonly PriceListRow[];
  readonly skipped: readonly SkippedPriceRow[];
}

function knownFieldOf(header: string): PriceListField | undefined {
  const normalized = normalizeHeader(header);
  return PRICE_LIST_FIELDS.find((field) => HEADER_SYNONYMS[field].includes(normalized));
}

/**
 * Finds the header of the list: the first of the first rows where at least two cells are names of a field. Without one,
 * the first row is the header.
 *
 * @param table the rows of the file, as text
 * @returns the header and the rows under it
 */
export function locateHeader(table: readonly (readonly string[])[]): PriceListTable {
  const limit = Math.min(table.length, HEADER_SEARCH_ROWS);
  let headerIndex = 0;
  for (let index = 0; index < limit; index += 1) {
    const known = new Set((table[index] ?? []).map(knownFieldOf).filter((field) => field !== undefined));
    if (known.size >= 2) {
      headerIndex = index;
      break;
    }
  }
  const headers = (table[headerIndex] ?? []).map((cell) => cell.trim());
  const rows = table
    .slice(headerIndex + 1)
    .map((cells, offset) => ({ rowNumber: headerIndex + offset + 2, cells }))
    .filter(({ cells }) => cells.some((cell) => cell.trim() !== ''));
  return { headers, rows };
}

/**
 * Chooses the columns to start from: what this supplier's last list used if all of it is still in the file, the agreed
 * header of E1-53 if the file has it, or a guess by the names of the headers.
 *
 * @param headers the header of the file
 * @param remembered the mapping saved with the last list of this supplier, if any
 * @returns the mapping and where it came from
 */
export function suggestMapping(headers: readonly string[], remembered: ColumnMapping | null): { mapping: ColumnMapping; origin: 'remembered' | 'agreed' | 'guessed' } {
  const present = new Set(headers.map(normalizeHeader));
  const covers = (mapping: ColumnMapping): boolean =>
    REQUIRED_PRICE_LIST_FIELDS.every((field) => mapping[field] !== undefined) &&
    Object.values(mapping).every((header) => header === undefined || present.has(normalizeHeader(header)));
  if (remembered !== null && covers(remembered)) {
    return { mapping: remembered, origin: 'remembered' };
  }
  if (covers(AGREED_PRICE_LIST_HEADERS)) {
    const mapping: ColumnMapping = {};
    for (const field of PRICE_LIST_FIELDS) {
      const agreed = AGREED_PRICE_LIST_HEADERS[field];
      if (agreed !== undefined && present.has(agreed)) {
        mapping[field] = headers.find((header) => normalizeHeader(header) === agreed);
      }
    }
    return { mapping, origin: 'agreed' };
  }
  const mapping: ColumnMapping = {};
  for (const header of headers) {
    const field = knownFieldOf(header);
    if (field !== undefined && mapping[field] === undefined) {
      mapping[field] = header;
    }
  }
  return { mapping, origin: 'guessed' };
}

/**
 * Tells whether a file has the header agreed with E1-53, which only the CSV of a paper catalog has.
 *
 * @param headers the header of the file
 * @returns true when every agreed header is there
 */
export function hasAgreedHeaders(headers: readonly string[]): boolean {
  const present = new Set(headers.map(normalizeHeader));
  return Object.values(AGREED_PRICE_LIST_HEADERS).every((header) => present.has(header));
}

/**
 * Tells which required fields a mapping leaves out, or points at a header the file does not have.
 *
 * @param headers the header of the file
 * @param mapping the columns the owner chose
 * @returns the fields that cannot be read
 */
export function missingFields(headers: readonly string[], mapping: ColumnMapping): PriceListField[] {
  const present = new Set(headers.map(normalizeHeader));
  return REQUIRED_PRICE_LIST_FIELDS.filter((field) => {
    const header = mapping[field];
    return header === undefined || !present.has(normalizeHeader(header));
  });
}

function trimmed(text: string | undefined, limit: number): string | null {
  const value = (text ?? '').replace(/\s+/gu, ' ').trim();
  return value === '' ? null : [...value].slice(0, limit).join('');
}

/**
 * Reads every row with the columns the owner chose. A row without code, description or a valid cost is left out with its
 * reason, and so is a code that already came in an earlier row, because a supplier's code names one item.
 *
 * @param table the header and the rows
 * @param mapping the columns of each field
 * @param costsIncludeVat whether the costs of the file include the VAT, which is then taken out
 * @returns the items and the rows left out
 */
export function readPriceListRows(table: PriceListTable, mapping: ColumnMapping, costsIncludeVat: boolean): PriceListReading {
  const columnOf = new Map<PriceListField, number>();
  const normalizedHeaders = table.headers.map(normalizeHeader);
  for (const field of PRICE_LIST_FIELDS) {
    const header = mapping[field];
    const index = header === undefined ? -1 : normalizedHeaders.indexOf(normalizeHeader(header));
    if (index >= 0) {
      columnOf.set(field, index);
    }
  }
  const cell = (cells: readonly string[], field: PriceListField): string | undefined => {
    const index = columnOf.get(field);
    return index === undefined ? undefined : cells[index];
  };
  const items: PriceListRow[] = [];
  const skipped: SkippedPriceRow[] = [];
  const seenCodes = new Set<string>();
  for (const { rowNumber, cells } of table.rows) {
    const supplierCode = (cell(cells, 'supplierCode') ?? '').trim();
    const description = trimmed(cell(cells, 'description'), MAX_ITEM_DESCRIPTION_LENGTH);
    if (supplierCode === '') {
      skipped.push({ rowNumber, reason: 'No trae código del proveedor.' });
      continue;
    }
    if ([...supplierCode].length > MAX_SUPPLIER_CODE_LENGTH || /[\u0000-\u001f\u007f]/u.test(supplierCode)) {
      skipped.push({ rowNumber, reason: `El código tiene más de ${MAX_SUPPLIER_CODE_LENGTH} caracteres o caracteres raros.` });
      continue;
    }
    if (description === null) {
      skipped.push({ rowNumber, reason: 'No trae descripción.' });
      continue;
    }
    const cost = readListCost(cell(cells, 'cost') ?? '');
    if (!cost.ok) {
      skipped.push({ rowNumber, reason: cost.reason });
      continue;
    }
    const pieces = readPiecesPerUnit(cell(cells, 'piecesPerUnit') ?? '');
    if (!pieces.ok) {
      skipped.push({ rowNumber, reason: pieces.reason });
      continue;
    }
    const key = supplierCode.toLowerCase();
    if (seenCodes.has(key)) {
      skipped.push({ rowNumber, reason: `El código ${supplierCode} ya venía en un renglón anterior.` });
      continue;
    }
    seenCodes.add(key);
    items.push({
      rowNumber,
      supplierCode,
      description,
      purchaseUnit: trimmed(cell(cells, 'purchaseUnit'), MAX_PURCHASE_UNIT_LENGTH),
      piecesPerUnitMilli: pieces.milli,
      listCostE6: costsIncludeVat ? removeVat(cost.costE6) : cost.costE6,
      barcode: trimmed(cell(cells, 'barcode'), 64),
    });
  }
  return { items, skipped };
}
