import { writeFileSync } from 'node:fs';

import type { UserRole } from '../../shared/auth';
import { CATALOG_FORMAT_LABELS, type CatalogExportRequest, type CatalogExportResult } from '../../shared/catalog-export';
import type { AuditLog } from '../audit/audit-log';
import { isRefusal, type OwnerGate } from '../auth/owner-gate';
import { buildWorkbook } from '../export/xlsx';
import type { CatalogReader } from './catalog-reader';
import { catalogCsv, catalogFileName, catalogHtml, catalogSheets, type CatalogHeader } from './catalog-files';
import { buildCatalogRow, catalogTotals, type CatalogRow } from './catalog-rows';

/** How many rows are worked out before the register gets a turn to answer the screen. */
const ROWS_PER_SLICE = 500;
const MOMENT = new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeStyle: 'short' });
const FILE_FAILED = 'No se pudo guardar el archivo. Revisa que la carpeta exista y que el archivo no esté abierto en otro programa.';

/** What the exporter needs from the outside, so a test can run it without Electron. */
export interface CatalogExporterDependencies {
  readonly reader: Pick<CatalogReader, 'read'>;
  readonly gate: Pick<OwnerGate, 'authorize'>;
  readonly audit: Pick<AuditLog, 'record'>;
  /** Opens the window to save a file. Returns the path, or null if the person cancelled. */
  readonly pickSavePath: (title: string, defaultName: string, filterName: string, extension: string) => Promise<string | null>;
  /** Turns a page of HTML into the bytes of a PDF, letter landscape. */
  readonly renderPdf: (html: string) => Promise<Buffer>;
  readonly businessName: () => string;
  readonly writeFile?: (path: string, bytes: Buffer) => void;
  readonly now?: () => Date;
}

/** Lets the event loop answer the screen before the next slice of work. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * Builds the rows a slice at a time, so a catalog of thousands of products never holds the main process for long.
 *
 * @param records the products as the database has them
 * @returns the rows, in the same order
 */
async function buildRowsInSlices(records: ReturnType<CatalogReader['read']>): Promise<CatalogRow[]> {
  const rows: CatalogRow[] = [];
  for (let start = 0; start < records.length; start += ROWS_PER_SLICE) {
    for (const record of records.slice(start, start + ROWS_PER_SLICE)) {
      rows.push(buildCatalogRow(record));
    }
    await yieldToEventLoop();
  }
  return rows;
}

/** The local day of a moment, as `YYYY-MM-DD`. */
function localDay(moment: Date): string {
  const month = String(moment.getMonth() + 1).padStart(2, '0');
  const day = String(moment.getDate()).padStart(2, '0');
  return `${moment.getFullYear()}-${month}-${day}`;
}

/**
 * Saves the whole catalog as a PDF, an Excel workbook or a CSV (E1-55, ADR 0071). The catalog has the costs and the
 * margins, so only an owner exports it: the owner signed in, or a cashier with the PIN of an owner. A refusal and every
 * file saved are written in the audit log.
 */
export class CatalogExporter {
  readonly #dependencies: CatalogExporterDependencies;

  /** @param dependencies the catalog, the gate of the owner, the audit log and the native windows */
  constructor(dependencies: CatalogExporterDependencies) {
    this.#dependencies = dependencies;
  }

  /**
   * Asks where to save the file, builds it and saves it.
   *
   * @param request the format, the filter and the PIN of an owner
   * @param user who is signed in
   * @returns where it was saved and how many products it has, or why not
   */
  async export(request: CatalogExportRequest, user: { readonly id: string; readonly role: UserRole }): Promise<CatalogExportResult> {
    const { format, activeOnly } = request;
    const deps = this.#dependencies;
    const approval = deps.gate.authorize({
      user,
      ownerPin: request.ownerPin,
      deniedAction: 'catalog.export_denied',
      entity: 'catalog',
      entityId: format,
      deniedDetail: `exportar el catálogo en ${CATALOG_FORMAT_LABELS[format]}`,
    });
    if (isRefusal(approval)) {
      return approval;
    }
    const moment = (deps.now ?? (() => new Date()))();
    const path = await deps.pickSavePath(`Guardar el catálogo en ${CATALOG_FORMAT_LABELS[format]}`, catalogFileName(localDay(moment), format), CATALOG_FORMAT_LABELS[format], format);
    if (path === null) {
      return { status: 'cancelled' };
    }
    try {
      const rows = await buildRowsInSlices(deps.reader.read(activeOnly));
      const totals = catalogTotals(rows);
      const header: CatalogHeader = { businessName: deps.businessName(), generatedAt: MOMENT.format(moment), activeOnly };
      await yieldToEventLoop();
      const bytes =
        format === 'csv'
          ? Buffer.from(catalogCsv(rows, totals, header), 'utf8')
          : format === 'xlsx'
            ? buildWorkbook(catalogSheets(rows, totals, header), { creator: header.businessName, created: moment })
            : await deps.renderPdf(catalogHtml(rows, totals, header));
      (deps.writeFile ?? writeFileSync)(path, bytes);
      deps.audit.record({
        userId: user.id,
        action: 'catalog.export',
        entity: 'catalog',
        entityId: format,
        detail: `${rows.length} productos (${activeOnly ? 'solo activos' : 'activos y dados de baja'}) en ${CATALOG_FORMAT_LABELS[format]}, aprobado por ${approval.ownerId}, guardado en ${path}`,
      });
      return { status: 'saved', path, productCount: rows.length };
    } catch {
      return { status: 'failed', message: FILE_FAILED };
    }
  }
}
