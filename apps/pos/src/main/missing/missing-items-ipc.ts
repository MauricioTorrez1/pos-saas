import type { UserSummary } from '../../shared/auth';
import {
  MISSING_CHANNELS,
  MISSING_PERIOD_CHOICES,
  MISSING_STATUSES,
  type MissingExportResult,
  type MissingItemRequest,
  type MissingItemsReport,
  type MissingPeriod,
  type MissingStatus,
  type RecordMissingResult,
} from '../../shared/missing-items';
import { exportMissingItems, type MissingExportDependencies } from './missing-items-export';
import type { MissingItemsLog } from './missing-items-log';

/** The longest text the bridge takes in any field; the log checks the real limits and answers in words. */
const MAX_FIELD_LENGTH = 200;

export interface MissingItemsServices {
  readonly log: MissingItemsLog;
  readonly exporter: Omit<MissingExportDependencies, 'report'>;
}

export type AnswerSignedInWithUser = <Result>(channel: string, respond: (argument: unknown, user: UserSummary) => Result) => void;

function optionalText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string' || value.length > MAX_FIELD_LENGTH) {
    throw new TypeError(`Expected a text of at most ${String(MAX_FIELD_LENGTH)} characters`);
  }
  return value;
}

/**
 * Reads what the screen sent to write down a missing item.
 *
 * @param value anything
 * @returns the request
 * @throws TypeError if it is not shaped as one
 */
export function parseMissingItemRequest(value: unknown): MissingItemRequest {
  const { description, quantity, notes } = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const text = optionalText(description);
  if (text === null) {
    throw new TypeError('Expected a description');
  }
  if (quantity !== null && quantity !== undefined && typeof quantity !== 'number') {
    throw new TypeError('Expected a quantity as a number, or none');
  }
  return { description: text, quantity: typeof quantity === 'number' ? quantity : null, notes: optionalText(notes) };
}

/**
 * Reads a period of the log.
 *
 * @param value anything
 * @returns the period
 * @throws TypeError if it is not one of the periods
 */
export function parseMissingPeriod(value: unknown): MissingPeriod {
  if (!(MISSING_PERIOD_CHOICES as readonly unknown[]).includes(value)) {
    throw new TypeError('Expected 30, 90, 365 or 0 days');
  }
  return value as MissingPeriod;
}

/**
 * Registers the channels of the log of missing items. Anyone signed in writes and reads it; only the owner decides.
 *
 * @param answerSignedIn registers a channel that needs a person signed in
 * @param refuse builds the error for a person who may not do something
 * @param services the log and what the PDF needs
 */
export function registerMissingItemsHandlers(answerSignedIn: AnswerSignedInWithUser, refuse: (message: string) => Error, { log, exporter }: MissingItemsServices): void {
  answerSignedIn(MISSING_CHANNELS.record, (value, user): RecordMissingResult => log.record(parseMissingItemRequest(value), user.id));
  answerSignedIn(MISSING_CHANNELS.report, (value): MissingItemsReport => log.report(parseMissingPeriod(value)));
  answerSignedIn(MISSING_CHANNELS.resolve, (value, user): void => {
    if (user.role !== 'owner') {
      throw refuse('Only the owner decides about a missing item');
    }
    const { key, status } = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
    if (typeof key !== 'string' || key.length === 0 || key.length > MAX_FIELD_LENGTH || !(MISSING_STATUSES as readonly unknown[]).includes(status)) {
      throw new TypeError('Expected the key of an item and pending, added or dismissed');
    }
    log.resolve(key, status as MissingStatus, user.id);
  });
  answerSignedIn(MISSING_CHANNELS.exportPdf, (value): Promise<MissingExportResult> =>
    exportMissingItems(parseMissingPeriod(value), { ...exporter, report: (period) => log.report(period) }),
  );
}
