import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BrowserWindow } from 'electron';

/** How a long page is printed. */
export interface PagedPdfOptions {
  /** Letter turned sideways, for wide tables such as the catalog. */
  readonly landscape: boolean;
  /** A short text on the left of the foot of every page, such as the name of the business. Escaped here. */
  readonly footerText?: string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The foot of every page: an optional text on the left and «Página X de Y» on the right. Chromium fills the two classes in.
 *
 * @param footerText the text on the left, or nothing
 * @returns the template of the foot
 */
export function pageFooter(footerText = ''): string {
  return (
    '<div style="width:100%;font-size:7px;color:#55626b;display:flex;justify-content:space-between;padding:0 8mm;">' +
    `<span>${escapeHtml(footerText)}</span>` +
    '<span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>'
  );
}

/**
 * Prints a long page of HTML to a PDF on letter paper, with the page number at the foot. A long page is several megabytes
 * of HTML, more than an address of Chromium can hold (2 MB), so the page is written to a temporary folder of its own and
 * loaded from there (ADR 0071). The window has no script, no Node and a sandbox; the page brings its own policy that
 * blocks the network. Printing happens in the process of that window, so the register keeps answering while it works. The
 * window and the folder are removed when it is done, or fails.
 *
 * @param html the page, which must be complete and must not need the network
 * @param options the orientation and the text of the foot
 * @returns the bytes of the PDF
 */
export async function printPagedPdf(html: string, options: PagedPdfOptions): Promise<Buffer> {
  const folder = mkdtempSync(join(tmpdir(), 'pos-report-'));
  const printer = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, javascript: false, nodeIntegration: false, contextIsolation: true },
  });
  try {
    const page = join(folder, 'report.html');
    writeFileSync(page, html, 'utf8');
    await printer.loadFile(page);
    return await printer.webContents.printToPDF({
      landscape: options.landscape,
      pageSize: 'Letter',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: pageFooter(options.footerText),
    });
  } finally {
    printer.destroy();
    rmSync(folder, { recursive: true, force: true });
  }
}
