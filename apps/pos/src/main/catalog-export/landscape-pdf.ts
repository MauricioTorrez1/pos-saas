import { printPagedPdf } from '../reports/paged-pdf';

/**
 * Prints the catalog to a PDF on letter paper turned sideways, with the page number at the foot (ADR 0071). The page is
 * loaded from a temporary file, because thousands of products do not fit in an address of Chromium.
 *
 * @param html the page, which must be complete and must not need the network
 * @returns the bytes of the PDF
 */
export function printLandscapePdf(html: string): Promise<Buffer> {
  return printPagedPdf(html, { landscape: true });
}
