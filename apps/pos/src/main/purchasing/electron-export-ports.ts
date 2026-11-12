import { join } from 'node:path';

import { app, BrowserWindow, dialog, shell } from 'electron';

import type { OrderFileFormat } from '../../shared/supplier-order';
import type { ExportPorts } from './order-exporter';

const FILTERS: Readonly<Record<OrderFileFormat, Electron.FileFilter>> = {
  xlsx: { name: 'Excel', extensions: ['xlsx'] },
  pdf: { name: 'PDF', extensions: ['pdf'] },
};

/**
 * Prints a page of HTML to PDF with the engine of the app, in a window nobody sees. The window has no script, no Node and
 * no way to load anything: the page is a text that comes with it. It is destroyed as soon as the PDF exists, or fails.
 *
 * @param html the page, which must be complete
 * @returns the bytes of the PDF, on A4 paper
 */
export async function printHtmlToPdf(html: string): Promise<Buffer> {
  const printer = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
  });
  try {
    await printer.loadURL(`data:text/html;charset=utf-8;base64,${Buffer.from(html, 'utf8').toString('base64')}`);
    return await printer.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally {
    printer.destroy();
  }
}

/**
 * The ports of the order exporter on a real computer: the "Save as" window of Windows, the printer of the engine, and the
 * file explorer.
 *
 * @param businessName reads the name of the business for the header of the files
 * @returns the ports
 */
export function electronExportPorts(businessName: () => string): ExportPorts {
  return {
    chooseSavePath: async (suggestedName, format) => {
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: format === 'xlsx' ? 'Guardar el pedido en Excel' : 'Guardar el pedido en PDF',
        defaultPath: join(app.getPath('documents'), suggestedName),
        filters: [FILTERS[format]],
      });
      return canceled || filePath === '' ? null : filePath;
    },
    renderPdf: printHtmlToPdf,
    revealInFolder: (path) => shell.showItemInFolder(path),
    businessName,
  };
}
