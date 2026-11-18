import { writeFileSync } from 'node:fs';

import {
  MISSING_PERIOD_LABELS,
  MISSING_STATUS_LABELS,
  type MissingCount,
  type MissingExportResult,
  type MissingItemsReport,
  type MissingPeriod,
} from '../../shared/missing-items';

const WEEKDAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'] as const;
const DATE_FORMAT = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium' });
const MOMENT_FORMAT = new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeStyle: 'short' });
/** The most asked items the horizontal chart shows; the table under it has all of them. */
const TOP_IN_CHART = 15;

const INK = '#1b2328';
const SOFT_INK = '#55626b';
const GRID = '#d5dbe0';
const BAR = '#2563eb';
const PEAK = '#c2410c';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function shortDay(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
}

/**
 * Draws a horizontal bar chart in SVG: one bar per item, the longest one in another color, with its number at its end.
 *
 * @param rows the label and the number of each bar, in the order they are drawn, and how the number reads if not as is
 * @returns the SVG, with every label escaped
 */
export function horizontalBars(rows: readonly { readonly label: string; readonly value: number; readonly valueText?: string }[]): string {
  const labelWidth = 260;
  const plotWidth = 400;
  const rowHeight = 22;
  const height = rows.length * rowHeight + 8;
  const peak = Math.max(1, ...rows.map((row) => row.value));
  const bars = rows
    .map((row, index) => {
      const y = index * rowHeight + 4;
      const width = Math.max(2, Math.round((row.value / peak) * plotWidth));
      const label = [...row.label].length > 38 ? `${[...row.label].slice(0, 37).join('')}…` : row.label;
      return (
        `<text x="${labelWidth - 8}" y="${y + 14}" text-anchor="end" font-size="11" fill="${INK}">${escapeHtml(label)}</text>` +
        `<rect x="${labelWidth}" y="${y + 3}" width="${width}" height="${rowHeight - 8}" rx="3" fill="${row.value === peak ? PEAK : BAR}"/>` +
        `<text x="${labelWidth + width + 6}" y="${y + 14}" font-size="11" fill="${SOFT_INK}">${escapeHtml(row.valueText ?? String(row.value))}</text>`
      );
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="${height}" viewBox="0 0 700 ${height}" role="img">${bars}</svg>`;
}

/**
 * Draws a vertical bar chart in SVG with a light grid, the number over each bar and the label under it.
 *
 * @param counts the bars, in order
 * @param labelOf how each key reads under its bar
 * @returns the SVG
 */
export function verticalBars(counts: readonly MissingCount[], labelOf: (key: string) => string): string {
  const width = 700;
  const plotHeight = 150;
  const top = 18;
  const bottom = 30;
  const peak = Math.max(1, ...counts.map((count) => count.count));
  const slot = width / Math.max(counts.length, 1);
  const barWidth = Math.min(48, slot * 0.7);
  // With many bars only some labels fit under them.
  const labelEvery = Math.ceil(counts.length / 13);
  const grid = [0.5, 1]
    .map((share) => {
      const y = top + plotHeight - share * plotHeight;
      return `<line x1="0" x2="${width}" y1="${y}" y2="${y}" stroke="${GRID}" stroke-width="1"/>`;
    })
    .join('');
  const bars = counts
    .map((count, index) => {
      const height = Math.round((count.count / peak) * plotHeight);
      const x = index * slot + (slot - barWidth) / 2;
      const y = top + plotHeight - height;
      const value = count.count > 0 && counts.length <= 26 ? `<text x="${x + barWidth / 2}" y="${y - 4}" text-anchor="middle" font-size="10" fill="${SOFT_INK}">${count.count}</text>` : '';
      const label = index % labelEvery === 0 ? `<text x="${x + barWidth / 2}" y="${top + plotHeight + 16}" text-anchor="middle" font-size="10" fill="${INK}">${escapeHtml(labelOf(count.key))}</text>` : '';
      return `<rect x="${x}" y="${y}" width="${barWidth}" height="${height}" rx="2" fill="${count.count === peak ? PEAK : BAR}"/>${value}${label}`;
    })
    .join('');
  const height = top + plotHeight + bottom;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img">${grid}${bars}<line x1="0" x2="${width}" y1="${top + plotHeight}" y2="${top + plotHeight}" stroke="${INK}" stroke-width="1"/></svg>`;
}

const PDF_STYLES = `
  body { font-family: 'Segoe UI', Arial, sans-serif; color: ${INK}; font-size: 11px; margin: 0; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  h2 { font-size: 14px; margin: 18px 0 6px; page-break-after: avoid; }
  p { margin: 2px 0; color: ${SOFT_INK}; }
  .kpis { display: flex; gap: 24px; margin: 12px 0; }
  .kpi strong { display: block; font-size: 20px; color: ${INK}; }
  figure { margin: 0 0 8px; page-break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 12px; }
  th, td { padding: 3px 6px; border-bottom: 1px solid #bfc7cd; text-align: left; vertical-align: top; }
  td.number { text-align: right; }
  thead th { border-bottom: 2px solid ${INK}; }
  tr { page-break-inside: avoid; }
`;

/**
 * Builds the page that becomes the PDF of the log: the totals, three charts and the table of every item. Every text is
 * escaped, because the descriptions are typed by people, and the page carries a policy that blocks scripts and the network.
 *
 * @param report the log of a period
 * @param businessName the name of the business for the title
 * @returns the HTML
 */
export function missingItemsHtml(report: MissingItemsReport, businessName: string): string {
  const pending = report.groups.filter((group) => group.status === 'pending').length;
  const parts = [
    `<h1>${escapeHtml(businessName)}</h1>`,
    `<p>Bitácora de faltantes · ${escapeHtml(MISSING_PERIOD_LABELS[report.period])}</p>`,
    `<p>Generada el ${escapeHtml(MOMENT_FORMAT.format(new Date(report.generatedAt)))}</p>`,
    `<div class="kpis"><div class="kpi"><strong>${report.totalRequests}</strong>veces que pidieron algo que no había</div>` +
      `<div class="kpi"><strong>${report.groups.length}</strong>productos distintos</div>` +
      `<div class="kpi"><strong>${pending}</strong>pendientes de decidir</div></div>`,
  ];
  if (report.groups.length === 0) {
    parts.push('<p>No se anotó ningún faltante en este periodo.</p>');
  } else {
    parts.push(
      '<h2>Lo más pedido</h2>',
      `<figure>${horizontalBars(report.groups.slice(0, TOP_IN_CHART).map((group) => ({ label: group.description, value: group.timesAsked })))}</figure>`,
      '<h2>Veces por semana</h2>',
      `<figure>${verticalBars(report.byWeek, shortDay)}</figure>`,
      '<h2>Veces por día de la semana</h2>',
      `<figure>${verticalBars(report.byWeekday, (key) => WEEKDAY_NAMES[Number(key)] ?? '')}</figure>`,
      '<h2>Todos los faltantes</h2>',
      `<table><thead><tr><th>Lo que pidieron</th><th>Veces</th><th>Cantidad</th><th>Notas</th><th>Última vez</th><th>Estado</th></tr></thead><tbody>${report.groups
        .map(
          (group) =>
            `<tr><td>${escapeHtml(group.description)}</td><td class="number">${group.timesAsked}</td><td class="number">${group.quantityAsked > 0 ? String(group.quantityAsked) : '—'}</td>` +
            `<td>${escapeHtml(group.notes.join('; '))}</td><td>${escapeHtml(DATE_FORMAT.format(new Date(group.lastAskedAt)))}</td><td>${MISSING_STATUS_LABELS[group.status]}</td></tr>`,
        )
        .join('')}</tbody></table>`,
    );
  }
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>Bitácora de faltantes</title><style>${PDF_STYLES}</style></head><body>${parts.join('')}</body></html>`;
}

/** What the exporter needs from the outside, so a test can run it without Electron. */
export interface MissingExportDependencies {
  readonly report: (period: MissingPeriod) => MissingItemsReport;
  readonly pickSavePath: (title: string, defaultName: string, filterName: string, extension: string) => Promise<string | null>;
  readonly renderPdf: (html: string) => Promise<Buffer>;
  readonly businessName: () => string;
  readonly writeFile?: (path: string, bytes: Buffer) => void;
}

/**
 * Saves the log of a period as a PDF where the person chooses.
 *
 * @param period the period
 * @param dependencies the log, the native windows and the name of the business
 * @returns where it was saved, or why not
 */
export async function exportMissingItems(period: MissingPeriod, dependencies: MissingExportDependencies): Promise<MissingExportResult> {
  const report = dependencies.report(period);
  const day = report.generatedAt.slice(0, 10);
  const path = await dependencies.pickSavePath('Guardar la bitácora de faltantes', `faltantes-${day}.pdf`, 'Documento PDF', 'pdf');
  if (path === null) {
    return { status: 'cancelled' };
  }
  try {
    const bytes = await dependencies.renderPdf(missingItemsHtml(report, dependencies.businessName()));
    (dependencies.writeFile ?? writeFileSync)(path, bytes);
    return { status: 'saved', path };
  } catch {
    return { status: 'failed', message: 'No se pudo guardar el PDF. Revisa que la carpeta exista y que el archivo no esté abierto en otro programa.' };
  }
}
