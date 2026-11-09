import { MoneyError, parseQuantity, parseUnitPriceE4, taxRateOf, type TaxRate, type Unit } from '@pos-saas/money';

/** One product of the file, ready to load. */
export interface CatalogRow {
  /** Line of the file, counting the header as line 1. */
  readonly line: number;
  readonly code: string;
  readonly name: string;
  readonly unit: Unit;
  /** Price per unit with VAT, in ten-thousandths of a peso. */
  readonly unitPriceE4: number;
  /** Cost per unit in millionths of a peso, when the file has it. */
  readonly unitCostE6?: number;
  /** What is on the shelf, in thousandths of the unit, when the file has it. */
  readonly stockMilli?: number;
  readonly taxRate: TaxRate;
}

/** A row that was left out, with why, so the owner can fix it in Eleventa or by hand. */
export interface InvalidRow {
  readonly line: number;
  readonly reason: string;
}

/** What reading a file gave. */
export type CatalogReading =
  | { readonly status: 'read'; readonly rows: readonly CatalogRow[]; readonly invalid: readonly InvalidRow[] }
  /** The file cannot be understood at all, such as one without a column of codes. */
  | { readonly status: 'unreadable'; readonly message: string };

const MAX_CODE_LENGTH = 50;
const MAX_NAME_LENGTH = 120;
const COST_E4_TO_E6 = 100;
const DEFAULT_TAX_RATE_BP = 1600;

/** The names a column can have in the files of Eleventa, without accents or capitals. */
const COLUMN_ALIASES = {
  code: ['codigo', 'codigo de barras', 'clave', 'sku', 'barcode', 'codigo barras'],
  name: ['descripcion', 'producto', 'nombre', 'articulo', 'descripcion del producto'],
  price: ['precio venta', 'precio de venta', 'precio publico', 'precio 1', 'precio'],
  cost: ['precio costo', 'costo', 'precio de costo'],
  stock: ['existencia', 'existencias', 'inventario', 'cantidad', 'stock'],
  unit: ['unidad', 'tipo de venta', 'unidad de medida', 'u/m'],
  tax: ['iva', 'impuesto', 'tasa de iva'],
} as const;

const UNIT_ALIASES: Readonly<Record<string, Unit>> = {
  pieza: 'piece', piezas: 'piece', pza: 'piece', pz: 'piece', unidad: 'piece', unitario: 'piece',
  kg: 'kilogram', kilo: 'kilogram', kilos: 'kilogram', kilogramo: 'kilogram', granel: 'kilogram',
  m: 'meter', mt: 'meter', mts: 'meter', metro: 'meter', metros: 'meter',
  l: 'liter', lt: 'liter', lts: 'liter', litro: 'liter', litros: 'liter',
};

/**
 * Splits a CSV into rows of fields. It reads commas, semicolons, or tabs, whichever the first line uses, keeps what is
 * inside quotes as it is, and ignores the byte order mark Excel adds and the lines with nothing in them.
 *
 * @param text the contents of the file
 * @returns the rows, the first being the header
 */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^﻿/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [';', '\t', ','].find((candidate) => firstLine.includes(candidate)) ?? ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    if (inQuotes) {
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      inQuotes = true;
    } else if (character === delimiter) {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') {
        index += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  row.push(field);
  rows.push(row);
  return rows.filter((fields) => fields.some((value) => value.trim() !== ''));
}

/**
 * Reads the catalog and the stock that Eleventa exports. Columns are found by name, so their order and capitals do not
 * matter. A bad row is left out and reported, and the rest still loads.
 *
 * @param text the contents of the file
 * @returns the products and the rows that were left out, or why the file cannot be understood
 */
export function parseEleventaCatalog(text: string): CatalogReading {
  const table = parseCsv(text);
  const header = table[0];
  if (header === undefined) {
    return { status: 'unreadable', message: 'El archivo está vacío.' };
  }
  const columns = Object.fromEntries(
    Object.entries(COLUMN_ALIASES).map(([key, aliases]) => [
      key,
      header.findIndex((title) => (aliases as readonly string[]).includes(normalize(title))),
    ]),
  ) as Record<keyof typeof COLUMN_ALIASES, number>;
  const missing = (['code', 'name', 'price'] as const).filter((key) => columns[key] === -1);
  if (missing.length > 0) {
    const names = { code: 'el código', name: 'la descripción', price: 'el precio de venta' };
    return { status: 'unreadable', message: `No se encontró ${missing.map((key) => names[key]).join(', ')} en la primera fila del archivo.` };
  }

  const rows: CatalogRow[] = [];
  const invalid: InvalidRow[] = [];
  const seen = new Set<string>();
  table.slice(1).forEach((fields, index) => {
    const line = index + 2;
    const result = readRow(fields, columns, line);
    if ('reason' in result) {
      invalid.push(result);
    } else if (seen.has(result.code)) {
      invalid.push({ line, reason: `El código ${result.code} está repetido en el archivo. Solo se carga la primera vez.` });
    } else {
      seen.add(result.code);
      rows.push(result);
    }
  });
  return { status: 'read', rows, invalid };
}

function readRow(fields: readonly string[], columns: Record<keyof typeof COLUMN_ALIASES, number>, line: number): CatalogRow | InvalidRow {
  const cell = (key: keyof typeof COLUMN_ALIASES): string => (columns[key] === -1 ? '' : (fields[columns[key]] ?? '').trim());
  const code = cell('code');
  const name = cell('name');
  if (code === '' || [...code].length > MAX_CODE_LENGTH || /[\u0000-\u001f]/.test(code)) {
    return { line, reason: 'El código está vacío, es demasiado largo o trae caracteres raros.' };
  }
  if (name === '' || [...name].length > MAX_NAME_LENGTH || /[\u0000-\u001f]/.test(name)) {
    return { line, reason: 'La descripción está vacía, es demasiado larga o trae caracteres raros.' };
  }
  const unit = readUnit(cell('unit'));
  if (unit === null) {
    return { line, reason: `No se entiende la unidad «${cell('unit')}».` };
  }
  try {
    const price = readMoney(cell('price'));
    const cost = cell('cost') === '' ? undefined : readMoney(cell('cost'));
    const stock = cell('stock') === '' ? undefined : readStock(cell('stock'), unit);
    return {
      line,
      code,
      name,
      unit,
      unitPriceE4: price,
      ...(cost === undefined ? {} : { unitCostE6: cost * COST_E4_TO_E6 }),
      ...(stock === undefined ? {} : { stockMilli: stock }),
      taxRate: readTax(cell('tax')),
    };
  } catch (error) {
    if (error instanceof MoneyError) {
      return { line, reason: describe(error, unit) };
    }
    throw error;
  }
}

function readMoney(text: string): number {
  return parseUnitPriceE4(text.replace(/[\s$,]/g, ''));
}

function readStock(text: string, unit: Unit): number {
  return parseQuantity(text.replace(/[\s,]/g, ''), unit).milli;
}

function readUnit(text: string): Unit | null {
  return text === '' ? 'piece' : (UNIT_ALIASES[normalize(text)] ?? null);
}

function readTax(text: string): TaxRate {
  const value = normalize(text);
  if (value === 'exento') {
    return taxRateOf('exempt', 0);
  }
  const percent = Number(value.replace('%', ''));
  return value === '' || !Number.isFinite(percent) ? taxRateOf('rate', DEFAULT_TAX_RATE_BP) : taxRateOf('rate', Math.round(percent * 100));
}

function describe(error: MoneyError, unit: Unit): string {
  switch (error.code) {
    case 'fractional_piece':
      return 'La existencia de piezas debe ser un número entero.';
    case 'too_many_decimals':
      return unit === 'piece' ? 'Hay demasiados decimales.' : 'Hay demasiados decimales: la existencia lleva 3 y el precio 4.';
    default:
      return 'Un precio o la existencia no es un número válido.';
  }
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
