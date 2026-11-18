/** Shapes of the catalog endpoints of the core (`core/catalog/web`). Amounts travel as text, never as `number`. */

/** Base units of the catalog, the same codes as `Unit` in the core. */
export const UNITS = ['piece', 'meter', 'kilogram', 'liter'] as const;

/** One of {@link UNITS}. */
export type UnitCode = (typeof UNITS)[number];

/** Spanish label of each unit. */
export const UNIT_LABELS: Record<UnitCode, string> = {
  piece: 'Pieza',
  meter: 'Metro',
  kilogram: 'Kilogramo',
  liter: 'Litro',
};

/** A code of a product: a barcode on the package or an alternate key of the store. */
export interface ProductCode {
  code: string;
  kind: 'barcode' | 'alternate';
}

/** A bulk presentation, such as a roll of 100 meters. */
export interface Presentation {
  name: string;
  /** Base units it holds, with 3 decimals: `"100.000"`. */
  baseQuantity: string;
}

/** A product as `GET /products/{id}` returns it. */
export interface Product {
  id: string;
  name: string;
  status: 'active' | 'inactive';
  unit: UnitCode;
  unitKind: string;
  codes: ProductCode[];
  presentations: Presentation[];
  /** Price per base unit with VAT included, with 4 decimals. */
  unitPrice: string;
  taxFactor: 'rate' | 'exempt';
  taxRateBp: number;
  satProductKey: string | null;
  satUnitKey: string | null;
  invoiceable: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A page of `GET /products`. */
export interface ProductPage {
  items: Product[];
  page: number;
  size: number;
  total: number;
}

/** Body of `POST /products` and `PATCH /products/{id}`. */
export interface ProductRequest {
  name: string;
  unit: UnitCode;
  status?: 'active' | 'inactive';
  codes: ProductCode[];
  presentations: Presentation[];
  unitPrice?: string;
  taxFactor: 'rate' | 'exempt';
  taxRateBp: number;
  satProductKey: string;
  satUnitKey: string;
}

/** A row of the file that was not loaded. */
export interface ImportRowError {
  line: number;
  reason: string;
}

/** Answer of `POST /imports/catalog`. */
export interface ImportReport {
  rowsRead: number;
  created: number;
  alreadyThere: number;
  pricesSkipped: number;
  invalid: ImportRowError[];
  ignoredColumns: string[];
  dryRun: boolean;
}

/** Roundings of a bulk price change. */
export const ROUNDINGS = ['cent', 'half_peso', 'peso'] as const;

/** One of {@link ROUNDINGS}. */
export type Rounding = (typeof ROUNDINGS)[number];

/** Spanish label of each rounding. */
export const ROUNDING_LABELS: Record<Rounding, string> = {
  cent: 'Al centavo',
  half_peso: 'A 50 centavos',
  peso: 'Al peso',
};

/** What a bulk price change asks for. */
export interface PriceChangeRequest {
  search: string;
  percent: string;
  rounding: Rounding;
}

/** One product of a bulk price change. */
export interface PriceLine {
  productId: string;
  name: string;
  currentPrice: string;
  newPrice: string;
}

/** Answer of `POST /price-changes`. */
export interface PriceChangeResult {
  applied: boolean;
  count: number;
  /** The first 500 products, ordered by name. */
  lines: PriceLine[];
}
