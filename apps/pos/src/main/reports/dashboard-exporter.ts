import { writeFileSync } from 'node:fs';

import type { UserSummary } from '../../shared/auth';
import type { DashboardRequest, ExportFormat, ExportResult } from '../../shared/dashboard-api';
import { exportFileName, summaryHtml, summarySheets } from './dashboard-export';
import type { DashboardService } from './dashboard-service';
import { buildWorkbook } from './xlsx-workbook';

/** What the exporter needs from the outside: the window to choose where to save, the printer of PDFs, and the name. */
export interface ExporterDependencies {
  /** Opens the window to save a file. Returns the path, or null if the person cancelled. */
  readonly pickSavePath: (title: string, defaultName: string, filterName: string, extension: string) => Promise<string | null>;
  /** Turns a page of HTML into the bytes of a PDF. */
  readonly renderPdf: (html: string) => Promise<Buffer>;
  readonly businessName: () => string;
  readonly writeFile?: (path: string, bytes: Buffer) => void;
}

/**
 * Saves the dashboard as an Excel file or a PDF. It reads the summary with the same permissions as the screen, so a
 * cashier exports only what the cashier could see: the file never has more than the screen had.
 */
export class DashboardExporter {
  readonly #service: Pick<DashboardService, 'summary'>;
  readonly #dependencies: ExporterDependencies;

  /**
   * @param service where the summary comes from
   * @param dependencies the native windows and the name of the business
   */
  constructor(service: Pick<DashboardService, 'summary'>, dependencies: ExporterDependencies) {
    this.#service = service;
    this.#dependencies = dependencies;
  }

  /**
   * Builds the file of a period and saves it where the person chooses.
   *
   * @param request the period, as the screen asked for it
   * @param format `xlsx` or `pdf`
   * @param user who is signed in
   * @returns where it was saved, or why not
   */
  async export(request: DashboardRequest, format: ExportFormat, user: UserSummary): Promise<ExportResult> {
    const result = this.#service.summary(request, user);
    if (result.status !== 'ok') {
      return result;
    }
    const { summary } = result;
    const isExcel = format === 'xlsx';
    const path = await this.#dependencies.pickSavePath(
      isExcel ? 'Guardar el resumen en Excel' : 'Guardar el resumen en PDF',
      exportFileName(summary, format),
      isExcel ? 'Libro de Excel' : 'Documento PDF',
      format,
    );
    if (path === null) {
      return { status: 'cancelled' };
    }
    try {
      const bytes = isExcel ? buildWorkbook(summarySheets(summary)) : await this.#dependencies.renderPdf(summaryHtml(summary, this.#dependencies.businessName()));
      (this.#dependencies.writeFile ?? writeFileSync)(path, bytes);
      return { status: 'saved', path };
    } catch {
      return { status: 'failed', message: 'No se pudo guardar el archivo. Revisa que la carpeta exista y que el archivo no esté abierto en otro programa.' };
    }
  }
}
