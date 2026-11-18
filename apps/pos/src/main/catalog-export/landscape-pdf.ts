import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BrowserWindow } from 'electron';

/** The number of the page and how many there are, at the foot of every page. Chromium fills the two classes in. */
const FOOTER = '<div style="width:100%;font-size:7px;color:#55626b;text-align:right;padding-right:8mm;">Página <span class="pageNumber"></span> de <span class="totalPages"></span></div>';

/**
 * Prints a long page of HTML to a PDF on letter paper turned sideways, with the page number at the foot. A catalog of
 * thousands of products is several megabytes of HTML, more than an address of Chromium can hold (2 MB), so the page is
 * written to a temporary folder of its own and loaded from there. The window has no script, no Node and a sandbox; the
 * page brings its own policy that blocks the network. Printing happens in the process of that window, so the register
 * keeps answering while it works. The window and the folder are removed when it is done, or fails.
 *
 * @param html the page, which must be complete and must not need the network
 * @returns the bytes of the PDF
 */
export async function printLandscapePdf(html: string): Promise<Buffer> {
  const folder = mkdtempSync(join(tmpdir(), 'pos-catalog-'));
  const printer = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, javascript: false, nodeIntegration: false, contextIsolation: true },
  });
  try {
    const page = join(folder, 'catalog.html');
    writeFileSync(page, html, 'utf8');
    await printer.loadFile(page);
    return await printer.webContents.printToPDF({
      landscape: true,
      pageSize: 'Letter',
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: FOOTER,
    });
  } finally {
    printer.destroy();
    rmSync(folder, { recursive: true, force: true });
  }
}
