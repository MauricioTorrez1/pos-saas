import type { UserSummary } from '../../shared/auth';
import { CATALOG_EXPORT_CHANNELS, CATALOG_EXPORT_FORMATS, type CatalogExportFormat, type CatalogExportRequest, type CatalogExportResult } from '../../shared/catalog-export';
import type { CatalogExporter } from './catalog-exporter';

/** A PIN is a few digits; anything longer did not come from the screen. */
const MAX_PIN_LENGTH = 32;

export type AnswerSignedIn = <Result>(channel: string, respond: (argument: unknown, user: UserSummary) => Result) => void;

/**
 * Reads what the screen sent to export the catalog. The bridge is checked again here, because the file must not depend on
 * the screen being right.
 *
 * @param value anything
 * @returns the request
 * @throws TypeError if it is not shaped as one
 */
export function parseCatalogExportRequest(value: unknown): CatalogExportRequest {
  const { format, activeOnly, ownerPin } = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  if (!(CATALOG_EXPORT_FORMATS as readonly unknown[]).includes(format)) {
    throw new TypeError('Expected pdf, xlsx or csv');
  }
  if (typeof activeOnly !== 'boolean') {
    throw new TypeError('Expected activeOnly as true or false');
  }
  if (ownerPin !== undefined && (typeof ownerPin !== 'string' || ownerPin.length > MAX_PIN_LENGTH)) {
    throw new TypeError('Expected the PIN of an owner as a short text');
  }
  return { format: format as CatalogExportFormat, activeOnly, ...(ownerPin === undefined ? {} : { ownerPin }) };
}

/**
 * Registers the channel that exports the catalog. Anyone signed in may ask, and the exporter lets through only the owner or
 * a cashier with the PIN of an owner, writing the refusals in the audit log.
 *
 * @param answerSignedIn registers a channel that needs a person signed in
 * @param exporter builds and saves the file
 */
export function registerCatalogExportHandlers(answerSignedIn: AnswerSignedIn, exporter: Pick<CatalogExporter, 'export'>): void {
  answerSignedIn(CATALOG_EXPORT_CHANNELS.exportCatalog, (value, user): Promise<CatalogExportResult> => exporter.export(parseCatalogExportRequest(value), user));
}
