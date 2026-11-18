/** The three files the whole catalog can be saved as (E1-55, ADR 0071). */
export const CATALOG_EXPORT_FORMATS = ['pdf', 'xlsx', 'csv'] as const;

export type CatalogExportFormat = (typeof CATALOG_EXPORT_FORMATS)[number];

/** What the screen asks for. */
export interface CatalogExportRequest {
  readonly format: CatalogExportFormat;
  /** True leaves out the products that were given up. The screen starts with it on. */
  readonly activeOnly: boolean;
  /** The PIN of an owner, when the person signed in is a cashier. */
  readonly ownerPin?: string;
}

/** How an export ended. */
export type CatalogExportResult =
  | { readonly status: 'saved'; readonly path: string; readonly productCount: number }
  | { readonly status: 'cancelled' }
  | { readonly status: 'authorization_required' }
  | { readonly status: 'wrong_pin'; readonly attemptsLeft: number }
  | { readonly status: 'locked'; readonly until: string }
  | { readonly status: 'failed'; readonly message: string };

export const CATALOG_EXPORT_CHANNELS = {
  exportCatalog: 'catalog:export',
} as const;

/** The bridge the screen uses to export the catalog. */
export interface CatalogExportApi {
  /**
   * Asks where to save the file, builds it and saves it.
   *
   * @param request the format, the filter and the PIN of an owner when a cashier asks
   * @returns where it was saved, or why not
   */
  exportCatalog(request: CatalogExportRequest): Promise<CatalogExportResult>;
}

/** The name of each format, as the screen and the window to save show it. */
export const CATALOG_FORMAT_LABELS: Readonly<Record<CatalogExportFormat, string>> = {
  pdf: 'PDF',
  xlsx: 'Excel (.xlsx)',
  csv: 'CSV',
};
