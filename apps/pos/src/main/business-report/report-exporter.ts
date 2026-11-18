import { writeFileSync } from 'node:fs';

import type { Accent } from '../../shared/appearance';
import type { UserSummary } from '../../shared/auth';
import type { BusinessReportRequest, ExportResult } from '../../shared/dashboard-api';
import { periodLabel } from '../../shared/dashboard-format';
import type { AuditLog } from '../audit/audit-log';
import { isRefusal, type OwnerGate } from '../auth/owner-gate';
import type { DashboardService } from '../reports/dashboard-service';
import { resolvePeriod } from '../reports/period';
import { businessReportFileName, businessReportHtml } from './report-html';
import type { ReportReader } from './report-reader';

const MOMENT = new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Mexico_City' });
const FILE_FAILED = 'No se pudo guardar el archivo. Revisa que la carpeta exista y que el archivo no esté abierto en otro programa.';

/** The accents of the register, darkened enough for white letters on the cover. */
export const ACCENT_COLORS: Readonly<Record<Accent, string>> = {
  yellow: '#b7791f',
  orange: '#c05621',
  red: '#c53030',
  blue: '#2b6cb0',
  green: '#2f855a',
  purple: '#6b46c1',
};

/** What the exporter needs from the outside, so a test can run it without Electron. */
export interface ReportExporterDependencies {
  readonly view: Pick<DashboardService, 'businessView'>;
  readonly reader: Pick<ReportReader, 'read'>;
  readonly gate: Pick<OwnerGate, 'authorize'>;
  readonly audit: Pick<AuditLog, 'record'>;
  /** Opens the window to save a file. Returns the path, or null if the person cancelled. */
  readonly pickSavePath: (title: string, defaultName: string, filterName: string, extension: string) => Promise<string | null>;
  /** Turns a page of HTML into the bytes of a PDF, with a text at the foot of every page. */
  readonly renderPdf: (html: string, footerText: string) => Promise<Buffer>;
  readonly businessName: () => string;
  readonly accent: () => Accent;
  readonly writeFile?: (path: string, bytes: Buffer) => void;
  readonly now?: () => Date;
}

/**
 * Saves the illustrated report of the business as one PDF (E1-57, ADR 0073): the summary, the income statement, the cash,
 * the inventory and the suppliers of a period, with charts and a plain reading. It has the costs and the profit, so only an
 * owner exports it: the owner signed in, or a cashier with the PIN of an owner. The approval is asked before the window to
 * save opens; a refusal and every file saved are written in the audit log.
 */
export class ReportExporter {
  readonly #dependencies: ReportExporterDependencies;

  /** @param dependencies the data, the gate of the owner, the audit log and the native windows */
  constructor(dependencies: ReportExporterDependencies) {
    this.#dependencies = dependencies;
  }

  /**
   * Asks for the approval of an owner, builds the report, asks where to save it and saves it.
   *
   * @param request the period and, for a cashier, the PIN of an owner
   * @param user who is signed in
   * @returns where it was saved, or why not
   * @throws RangeError if a day does not exist or the range is not valid
   */
  async export(request: BusinessReportRequest, user: UserSummary): Promise<ExportResult> {
    const deps = this.#dependencies;
    const approval = deps.gate.authorize({
      user,
      ownerPin: request.ownerPin,
      deniedAction: 'report.business_report_denied',
      entity: 'dashboard',
      entityId: 'business_report',
      deniedDetail: 'exportar el reporte ilustrado del negocio',
    });
    if (isRefusal(approval)) {
      return approval;
    }
    const { period, date, endDate } = request;
    const range = resolvePeriod(period, date, endDate);
    const { summary, statement } = deps.view.businessView({ period, date, ...(endDate === undefined ? {} : { endDate }), topMetric: 'amount', topLimit: 10 });
    const extras = deps.reader.read(new Date(range.fromMs).toISOString(), new Date(range.toMs).toISOString());
    const path = await deps.pickSavePath('Guardar el reporte del negocio en PDF', businessReportFileName(summary), 'Documento PDF', 'pdf');
    if (path === null) {
      return { status: 'cancelled' };
    }
    try {
      const businessName = deps.businessName();
      const moment = (deps.now ?? (() => new Date()))();
      const html = businessReportHtml({
        businessName,
        accentColor: ACCENT_COLORS[deps.accent()],
        generatedAt: MOMENT.format(moment),
        summary,
        statement,
        extras,
      });
      (deps.writeFile ?? writeFileSync)(path, await deps.renderPdf(html, `${businessName} · Reporte del negocio · ${periodLabel(summary.period)}`));
      deps.audit.record({
        userId: user.id,
        action: 'report.business_report',
        entity: 'dashboard',
        entityId: 'business_report',
        detail: `reporte ilustrado de ${summary.period.fromDay} a ${summary.period.toDay}, aprobado por ${approval.ownerId}, guardado en ${path}`,
      });
      return { status: 'saved', path };
    } catch {
      return { status: 'failed', message: FILE_FAILED };
    }
  }
}
