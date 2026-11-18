import { isZeroAmount, parseDecimalInput } from './decimal-text';
import { UNITS, type Product, type ProductCode, type ProductRequest, type UnitCode } from './types';

/** VAT choices of the form, the same three rates and exemption the core accepts (F0-17). */
export const TAX_OPTIONS = [
  { value: 'rate-1600', label: 'IVA 16%', factor: 'rate', bp: 1600 },
  { value: 'rate-800', label: 'IVA 8% (frontera)', factor: 'rate', bp: 800 },
  { value: 'rate-0', label: 'IVA 0%', factor: 'rate', bp: 0 },
  { value: 'exempt', label: 'Exento', factor: 'exempt', bp: 0 },
] as const;

/** What the product form holds, all as typed text. */
export interface ProductFormInput {
  name: string;
  unit: string;
  status: string;
  /** One barcode per line. */
  barcodes: string;
  /** One alternate key per line. */
  alternates: string;
  presentationNames: string[];
  presentationQuantities: string[];
  tax: string;
  /** Only when creating, and only for who may set prices. */
  unitPrice: string | null;
  satProductKey: string;
  satUnitKey: string;
}

/** Fields that can carry an error message. */
export type ProductField =
  | 'name'
  | 'unit'
  | 'codes'
  | 'presentations'
  | 'tax'
  | 'unitPrice'
  | 'satProductKey'
  | 'satUnitKey';

/** Messages per field, in Spanish for the owner. */
export type FieldErrors = Partial<Record<ProductField, string>>;

/** Outcome of reading the form. */
export type ParsedProductForm = { ok: true; request: ProductRequest } | { ok: false; errors: FieldErrors };

const MAX_NAME_LENGTH = 200;
const MAX_CODE_LENGTH = 64;

function lines(text: string): string[] {
  return text
    .split(/[\r\n,]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function readCodes(input: ProductFormInput, errors: FieldErrors): ProductCode[] {
  const codes: ProductCode[] = [
    ...lines(input.barcodes).map((code) => ({ code, kind: 'barcode' as const })),
    ...lines(input.alternates).map((code) => ({ code, kind: 'alternate' as const })),
  ];
  const seen = new Set<string>();
  for (const { code } of codes) {
    if (code.length > MAX_CODE_LENGTH || /\s/.test(code)) {
      errors.codes = `El código «${code.slice(0, 20)}» no es válido: sin espacios y de hasta ${MAX_CODE_LENGTH} caracteres.`;
    } else if (seen.has(code)) {
      errors.codes = `El código ${code} está repetido.`;
    }
    seen.add(code);
  }
  return codes;
}

function readPresentations(input: ProductFormInput, errors: FieldErrors): ProductRequest['presentations'] {
  const presentations: ProductRequest['presentations'] = [];
  input.presentationNames.forEach((rawName, index) => {
    const name = rawName.trim();
    const rawQuantity = (input.presentationQuantities[index] ?? '').trim();
    if (!name && !rawQuantity) {
      return;
    }
    const baseQuantity = parseDecimalInput(rawQuantity, 3);
    if (!name) {
      errors.presentations = 'Cada presentación necesita un nombre, por ejemplo «Rollo».';
    } else if (baseQuantity === null || isZeroAmount(baseQuantity)) {
      errors.presentations = `La presentación «${name}» necesita una cantidad mayor que cero, con hasta 3 decimales.`;
    } else {
      presentations.push({ name, baseQuantity });
    }
  });
  return presentations;
}

/**
 * Checks the product form and builds the body for the core.
 *
 * This is the first check, so the owner sees every mistake at once and next to its field. The core checks again
 * and has the last word (duplicate codes, SAT keys that do not exist).
 *
 * @param input - The typed form.
 * @returns The request, or the errors per field.
 */
export function parseProductForm(input: ProductFormInput): ParsedProductForm {
  const errors: FieldErrors = {};
  const name = input.name.trim().replace(/\s+/g, ' ');
  if (!name) {
    errors.name = 'Escribe el nombre del producto.';
  } else if (name.length > MAX_NAME_LENGTH) {
    errors.name = `El nombre puede tener hasta ${MAX_NAME_LENGTH} caracteres.`;
  }
  if (!(UNITS as readonly string[]).includes(input.unit)) {
    errors.unit = 'Elige la unidad en la que se vende.';
  }
  const tax = TAX_OPTIONS.find((option) => option.value === input.tax);
  if (!tax) {
    errors.tax = 'Elige el IVA del producto.';
  }
  let unitPrice: string | undefined;
  if (input.unitPrice !== null && input.unitPrice.trim() !== '') {
    const parsed = parseDecimalInput(input.unitPrice, 4);
    if (parsed === null || isZeroAmount(parsed)) {
      errors.unitPrice = 'Escribe un precio mayor que cero, con hasta 4 decimales, por ejemplo 125.50.';
    } else {
      unitPrice = parsed;
    }
  }
  const satProductKey = input.satProductKey.trim();
  if (satProductKey && !/^\d{8}$/.test(satProductKey)) {
    errors.satProductKey = 'La clave de producto del SAT tiene 8 dígitos, por ejemplo 31161500.';
  }
  const satUnitKey = input.satUnitKey.trim().toUpperCase();
  if (satUnitKey && !/^[A-Z0-9]{2,3}$/.test(satUnitKey)) {
    errors.satUnitKey = 'La clave de unidad del SAT tiene 2 o 3 letras o números, por ejemplo H87.';
  }
  const codes = readCodes(input, errors);
  const presentations = readPresentations(input, errors);

  if (Object.keys(errors).length > 0 || !tax) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    request: {
      name,
      unit: input.unit as UnitCode,
      status: input.status === 'inactive' ? 'inactive' : 'active',
      codes,
      presentations,
      ...(unitPrice === undefined ? {} : { unitPrice }),
      taxFactor: tax.factor,
      taxRateBp: tax.bp,
      satProductKey,
      satUnitKey,
    },
  };
}

function text(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
}

/**
 * Reads the product form out of the data a browser posts.
 *
 * @param data - The posted form.
 * @param withPrice - Whether the form had a price field (only on creation, for who may set prices).
 */
export function productFormFromData(data: FormData, withPrice: boolean): ProductFormInput {
  const all = (name: string) => data.getAll(name).map((value) => (typeof value === 'string' ? value : ''));
  return {
    name: text(data, 'name'),
    unit: text(data, 'unit'),
    status: text(data, 'status'),
    barcodes: text(data, 'barcodes'),
    alternates: text(data, 'alternates'),
    presentationNames: all('presentationName'),
    presentationQuantities: all('presentationQuantity'),
    tax: text(data, 'tax'),
    unitPrice: withPrice ? text(data, 'unitPrice') : null,
    satProductKey: text(data, 'satProductKey'),
    satUnitKey: text(data, 'satUnitKey'),
  };
}

/**
 * Fills the form with a product of the core, to edit it.
 *
 * @param product - The product, or `null` for a new one (piece, 16% VAT).
 */
export function productFormFromProduct(product: Product | null): ProductFormInput {
  if (!product) {
    return {
      name: '',
      unit: 'piece',
      status: 'active',
      barcodes: '',
      alternates: '',
      presentationNames: [],
      presentationQuantities: [],
      tax: 'rate-1600',
      unitPrice: '',
      satProductKey: '',
      satUnitKey: '',
    };
  }
  const codesOf = (kind: ProductCode['kind']) =>
    product.codes
      .filter((code) => code.kind === kind)
      .map((code) => code.code)
      .join('\n');
  return {
    name: product.name,
    unit: product.unit,
    status: product.status,
    barcodes: codesOf('barcode'),
    alternates: codesOf('alternate'),
    presentationNames: product.presentations.map((presentation) => presentation.name),
    presentationQuantities: product.presentations.map((presentation) => presentation.baseQuantity),
    tax: product.taxFactor === 'exempt' ? 'exempt' : `rate-${product.taxRateBp}`,
    unitPrice: null,
    satProductKey: product.satProductKey ?? '',
    satUnitKey: product.satUnitKey ?? '',
  };
}
