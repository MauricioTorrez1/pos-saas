import { writeFileSync } from 'node:fs';

import type { UserSummary } from '../../shared/auth';
import type { DashboardRequest, ExportFormat, ExportResult } from '../../shared/dashboard-api';
import type { IncomeStatement, StatementRequest } from '../../shared/income-statement';
import { exportFileName, statementHtml, summaryHtml, summarySheets } from './dashboard-export';
import { statementFileName, statementSheet } from './income-statement-export';
import type { DashboardService } from './dashboard-service';
import { buildWorkbook } from '../export/xlsx';

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
  readonly #service: Pick<DashboardService, 'summary' | 'statement'>;
  readonly #dependencies: ExporterDependencies;

  /**
   * @param service where the summary comes from
   * @param dependencies the native windows and the name of the business
   */
  constructor(service: Pick<DashboardService, 'summary' | 'statement'>, dependencies: ExporterDependencies) {
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
    // The statement goes in only when the summary is the whole business, which already proved the person may see it.
    const statement = summary.scope === 'business' ? this.#statementOf(request, user) : null;
    const isExcel = format === 'xlsx';
    return this.#save(
      isExcel ? 'Guardar el resumen en Excel' : 'Guardar el resumen en PDF',
      exportFileName(summary, format),
      format,
      async () => (isExcel ? buildWorkbook(summarySheets(summary, statement)) : this.#dependencies.renderPdf(summaryHtml(summary, this.#dependencies.businessName(), statement))),
    );
  }

  /**
   * Saves the income statement alone, «Desde el inicio» included, with the same permissions as the screen.
   *
   * @param request the period, as the screen asked for it
   * @param format `xlsx` or `pdf`
   * @param user who is signed in
   * @returns where it was saved, or why not
   */
  async exportStatement(request: StatementRequest, format: ExportFormat, user: UserSummary): Promise<ExportResult> {
    const result = this.#service.statement(request, user);
    if (result.status !== 'ok') {
      return result;
    }
    const { statement } = result;
    const isExcel = format === 'xlsx';
    return this.#save(
      isExcel ? 'Guardar el estado de resultados en Excel' : 'Guardar el estado de resultados en PDF',
      statementFileName(statement, format),
      format,
      async () => (isExcel ? buildWorkbook([statementSheet(statement)]) : this.#dependencies.renderPdf(statementHtml(statement, this.#dependencies.businessName()))),
    );
  }

  #statementOf(request: DashboardRequest, user: UserSummary): IncomeStatement | null {
    const result = this.#service.statement(
      { period: request.period, date: request.date, ...(request.endDate === undefined ? {} : { endDate: request.endDate }), ...(request.ownerPin === undefined ? {} : { ownerPin: request.ownerPin }) },
      user,
    );
    return result.status === 'ok' ? result.statement : null;
  }

  async #save(title: string, defaultName: string, format: ExportFormat, build: () => Promise<Buffer>): Promise<ExportResult> {
    const isExcel = format === 'xlsx';
    const path = await this.#dependencies.pickSavePath(title, defaultName, isExcel ? 'Libro de Excel' : 'Documento PDF', format);
    if (path === null) {
      return { status: 'cancelled' };
    }
    try {
      (this.#dependencies.writeFile ?? writeFileSync)(path, await build());
      return { status: 'saved', path };
    } catch {
      return { status: 'failed', message: 'No se pudo guardar el archivo. Revisa que la carpeta exista y que el archivo no esté abierto en otro programa.' };
    }
  }
}
