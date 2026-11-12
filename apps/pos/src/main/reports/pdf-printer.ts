import { BrowserWindow } from 'electron';

/**
 * Turns a page of HTML into a PDF with the printer of Chromium that Electron already carries, so no library is needed. The
 * page loads in a hidden window with no scripts, no Node and a sandbox, and the window is destroyed as soon as it is done.
 *
 * @param html the page, which must be complete and must not need the network
 * @returns the bytes of the PDF, on letter paper
 */
export async function printHtmlToPdf(html: string): Promise<Buffer> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, javascript: false, nodeIntegration: false, contextIsolation: true },
  });
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return await window.webContents.printToPDF({ pageSize: 'Letter', printBackground: false });
  } finally {
    window.destroy();
  }
}
