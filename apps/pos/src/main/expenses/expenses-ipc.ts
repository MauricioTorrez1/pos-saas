import type { UserSummary } from '../../shared/auth';
import {
  EXPENSE_CHANNELS,
  MAX_EXPENSE_CONCEPTS,
  type ExpenseListRequest,
  type ExpenseListResult,
  type ExpenseRequest,
  type RecordExpenseResult,
  type SaveConceptsRequest,
  type SaveConceptsResult,
  type VoidExpenseRequest,
  type VoidExpenseResult,
} from '../../shared/expenses';
import type { ExpenseBook } from './expense-book';

/** The longest text the bridge takes in any field; the book checks the real limits and answers in words. */
const MAX_FIELD_LENGTH = 200;
const MAX_PIN_LENGTH = 32;

type AnswerSignedIn = <Result>(channel: string, respond: (argument: unknown, user: UserSummary) => Result) => void;

function recordOf(value: unknown, description: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`Expected ${description}`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length > MAX_FIELD_LENGTH) {
    throw new TypeError(`Expected ${field} as a text of at most ${String(MAX_FIELD_LENGTH)} characters`);
  }
  return value;
}

function day(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length !== 10) {
    throw new TypeError(`Expected ${field} as YYYY-MM-DD`);
  }
  return value;
}

function pin(value: unknown): { ownerPin?: string } {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== 'string' || value.length > MAX_PIN_LENGTH) {
    throw new TypeError('Expected the PIN as text');
  }
  return { ownerPin: value };
}

/**
 * Checks the shape of an expense that came over the bridge. The book checks the values.
 *
 * @param value what the screen sent
 * @returns the request
 * @throws TypeError if a field is missing or has the wrong type
 */
export function parseExpenseRequest(value: unknown): ExpenseRequest {
  const record = recordOf(value, 'an expense');
  if (typeof record.amountCents !== 'number') {
    throw new TypeError('Expected the amount in cents');
  }
  if (typeof record.paidFromDrawer !== 'boolean') {
    throw new TypeError('Expected whether it was paid from the drawer');
  }
  return {
    concept: text(record.concept, 'the concept'),
    amountCents: record.amountCents,
    day: day(record.day, 'the day'),
    note: record.note === null || record.note === undefined ? null : text(record.note, 'the note'),
    paidFromDrawer: record.paidFromDrawer,
    ...pin(record.ownerPin),
  };
}

/**
 * Checks the days of a list of expenses.
 *
 * @param value what the screen sent
 * @returns the request
 * @throws TypeError if a day is missing
 */
export function parseExpenseListRequest(value: unknown): ExpenseListRequest {
  const record = recordOf(value, 'the days of the expenses');
  return { fromDay: day(record.fromDay, 'the first day'), toDay: day(record.toDay, 'the last day'), ...pin(record.ownerPin) };
}

/**
 * Checks a request to void an expense.
 *
 * @param value what the screen sent
 * @returns the request
 * @throws TypeError if the id or the reason is missing
 */
export function parseVoidExpenseRequest(value: unknown): VoidExpenseRequest {
  const record = recordOf(value, 'the expense to void');
  return { id: text(record.id, 'the id'), reason: text(record.reason, 'the reason'), ...pin(record.ownerPin) };
}

/**
 * Checks a new list of concepts.
 *
 * @param value what the screen sent
 * @returns the request
 * @throws TypeError if it is not a short list of texts
 */
export function parseSaveConceptsRequest(value: unknown): SaveConceptsRequest {
  const record = recordOf(value, 'the concepts');
  const { concepts } = record;
  if (!Array.isArray(concepts) || concepts.length > MAX_EXPENSE_CONCEPTS * 2) {
    throw new TypeError('Expected a short list of concepts');
  }
  return { concepts: concepts.map((concept) => text(concept, 'a concept')), ...pin(record.ownerPin) };
}

/**
 * Registers the channels of the expenses. Anyone signed in may ask; the book refuses unless the person is an owner or
 * typed the PIN of one, and writes the refusal in the audit log.
 *
 * @param answerSignedIn registers a channel that needs a person signed in
 * @param book the book of expenses
 */
export function registerExpenseHandlers(answerSignedIn: AnswerSignedIn, book: ExpenseBook): void {
  answerSignedIn(EXPENSE_CHANNELS.record, (value, user): RecordExpenseResult => book.record(parseExpenseRequest(value), user));
  answerSignedIn(EXPENSE_CHANNELS.list, (value, user): ExpenseListResult => book.list(parseExpenseListRequest(value), user));
  answerSignedIn(EXPENSE_CHANNELS.void, (value, user): VoidExpenseResult => book.void(parseVoidExpenseRequest(value), user));
  answerSignedIn(EXPENSE_CHANNELS.saveConcepts, (value, user): SaveConceptsResult => book.saveConcepts(parseSaveConceptsRequest(value), user));
}
