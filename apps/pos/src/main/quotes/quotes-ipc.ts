import { ticketLineWidth, type TicketDesign } from '../../shared/register-tools';
import {
  MAX_QUOTE_LINES,
  QUOTE_CHANNELS,
  QUOTE_STATUS_FILTERS,
  type CancelQuoteRequest,
  type CancelQuoteResult,
  type MarkConvertedRequest,
  type MarkConvertedResult,
  type PrepareConversionResult,
  type PrintQuoteResult,
  type Quote,
  type QuoteLineInput,
  type QuoteSearch,
  type QuoteStatusFilter,
  type QuoteSummary,
  type SaveQuoteRequest,
  type SaveQuoteResult,
} from '../../shared/quotes';
import { renderParts } from '../checkout/ticket/ticket';
import { DeviceError } from '../hardware/device-error';
import type { PrinterProvider } from '../hardware/printer-provider';
import type { AnswerSignedInWithUser } from '../missing/missing-items-ipc';
import type { QuoteBook } from './quote-book';
import { composeQuoteTicket } from './quote-ticket';

/** The longest text the bridge takes; the book checks the real limits and answers in words. */
const MAX_FIELD_LENGTH = 400;
const MAX_ID_LENGTH = 64;

/** What the quotes need besides the book: the ticket printer and how the ticket looks. */
export interface QuoteServices {
  readonly book: QuoteBook;
  readonly printer: Pick<PrinterProvider, 'print'> & { isConfigured(): boolean };
  readonly ticketDesign: () => TicketDesign;
  readonly businessName: () => string;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function requireId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_LENGTH) {
    throw new TypeError('Expected the id of a quote');
  }
  return value;
}

function optionalText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string' || value.length > MAX_FIELD_LENGTH) {
    throw new TypeError(`Expected a text of at most ${String(MAX_FIELD_LENGTH)} characters`);
  }
  return value;
}

function parseLine(value: unknown): QuoteLineInput {
  const { productId, quantityMilli } = record(value);
  if (typeof quantityMilli !== 'number') {
    throw new TypeError('Expected a quantity in thousandths');
  }
  return { productId: requireId(productId), quantityMilli };
}

/**
 * Reads a quote to save as the screen sent it.
 *
 * @param value anything
 * @returns the request
 * @throws TypeError if it is not shaped as one
 */
export function parseSaveQuoteRequest(value: unknown): SaveQuoteRequest {
  const { quoteId, idempotencyKey, customerName, customerPhone, notes, validUntil, lines, duplicatedFrom } = record(value);
  if (typeof validUntil !== 'string' || validUntil.length > 10) {
    throw new TypeError('Expected the last valid day as YYYY-MM-DD');
  }
  if (!Array.isArray(lines) || lines.length > MAX_QUOTE_LINES * 2) {
    throw new TypeError('Expected the lines of the quote');
  }
  return {
    quoteId: quoteId === null || quoteId === undefined ? null : requireId(quoteId),
    idempotencyKey: requireId(idempotencyKey),
    customerName: optionalText(customerName),
    customerPhone: optionalText(customerPhone),
    notes: optionalText(notes),
    validUntil,
    lines: lines.map(parseLine),
    duplicatedFrom: duplicatedFrom === null || duplicatedFrom === undefined ? null : requireId(duplicatedFrom),
  };
}

/**
 * Reads a search of the list.
 *
 * @param value anything
 * @returns the search
 * @throws TypeError if it is not shaped as one
 */
export function parseQuoteSearch(value: unknown): QuoteSearch {
  const { text, status } = record(value);
  if (typeof text !== 'string' || text.length > 100 || !(QUOTE_STATUS_FILTERS as readonly unknown[]).includes(status)) {
    throw new TypeError('Expected a text and a status to search for');
  }
  return { text, status: status as QuoteStatusFilter };
}

function parseCancelRequest(value: unknown): CancelQuoteRequest {
  const { quoteId, reason, ownerPin } = record(value);
  const text = optionalText(reason) ?? '';
  const pin = optionalText(ownerPin);
  return { quoteId: requireId(quoteId), reason: text, ...(pin === null ? {} : { ownerPin: pin }) };
}

function parseMarkConverted(value: unknown): MarkConvertedRequest {
  const { quoteId, saleId } = record(value);
  return { quoteId: requireId(quoteId), saleId: requireId(saleId) };
}

function center(text: string, width: number): string {
  const length = [...text].length;
  return length >= width ? text : `${' '.repeat(Math.floor((width - length) / 2))}${text}`;
}

/**
 * Registers the channels of the quotes. Anyone signed in makes, edits, prints and sells them; the book decides who may
 * cancel one.
 *
 * @param answerSignedIn registers a channel that needs a person signed in
 * @param services the book, the printer and the design of the ticket
 */
export function registerQuoteHandlers(answerSignedIn: AnswerSignedInWithUser, { book, printer, ticketDesign, businessName }: QuoteServices): void {
  const requireQuote = (quoteId: string): Quote => {
    const quote = book.get(quoteId);
    if (quote === null) {
      throw new TypeError('No quote has that id');
    }
    return quote;
  };

  answerSignedIn(QUOTE_CHANNELS.list, (value): QuoteSummary[] => book.list(parseQuoteSearch(value)));
  answerSignedIn(QUOTE_CHANNELS.get, (value): Quote | null => book.get(requireId(value)));
  answerSignedIn(QUOTE_CHANNELS.save, (value, user): SaveQuoteResult => book.save(parseSaveQuoteRequest(value), user));
  answerSignedIn(QUOTE_CHANNELS.cancel, (value, user): CancelQuoteResult => book.cancel(parseCancelRequest(value), user));
  answerSignedIn(QUOTE_CHANNELS.prepareConversion, (value): PrepareConversionResult => book.prepareConversion(requireId(value)));
  answerSignedIn(QUOTE_CHANNELS.markConverted, (value, user): MarkConvertedResult => book.markConverted(parseMarkConverted(value), user));
  answerSignedIn(QUOTE_CHANNELS.preview, (value): string[] => {
    const quote = requireQuote(requireId(value));
    const design = ticketDesign();
    return composeQuoteTicket(quote, businessName(), design, quote.timesPrinted > 0).map((part) =>
      part.align === 'center' ? center(part.text, ticketLineWidth(design, part.big)) : part.text,
    );
  });
  answerSignedIn(QUOTE_CHANNELS.print, async (value, user): Promise<PrintQuoteResult> => {
    const quoteId = requireId(value);
    requireQuote(quoteId);
    if (!printer.isConfigured()) {
      return { status: 'no_printer' };
    }
    const printed = book.recordPrint(quoteId, user.id)!;
    const design = ticketDesign();
    try {
      await printer.print(renderParts(() => composeQuoteTicket(printed.quote, businessName(), design, printed.isReprint), design, 1));
      return { status: 'printed' };
    } catch (error) {
      return { status: 'failed', message: error instanceof DeviceError ? error.message : String(error) };
    }
  });
}
