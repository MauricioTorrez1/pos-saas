import { quantityOf, taxRateOf } from '@pos-saas/money';

import type { UserSummary } from '../../shared/auth';
import {
  isKeymap,
  isTicketDesign,
  normalizePrinterShare,
  TOOLS_CHANNELS,
  type Keymap,
  type SaleSummary,
  type SavePrinterResult,
  type TestPrintResult,
  type TicketDesign,
} from '../../shared/register-tools';
import type { AuditLog } from '../audit/audit-log';
import { composeTicket, renderTicket, type TicketData } from '../checkout/ticket/ticket';
import { DeviceError } from '../hardware/device-error';
import type { SalesHistory } from './sales-history';
import type { SwitchablePrinter } from './switchable-printer';
import type { ToolsStore } from './tools-store';

const MAX_SEARCH_LENGTH = 40;
const MAX_SALE_LINES = 500;
/** A sale never reaches this, and a larger number is not a total. */
const MAX_TOTAL_CENTS = 10_000_000_000;
/** A sale that was dropped was never saved, so it has no id of its own, and its entries hang from this fixed one. */
const UNSAVED_SALE_ID = '00000000-0000-7000-8000-000000000000';

export interface ToolsServices {
  readonly store: ToolsStore;
  readonly history: SalesHistory;
  readonly printer: SwitchablePrinter;
  readonly audit: Pick<AuditLog, 'record'>;
  readonly businessName: () => string;
}

export type AnswerSignedInWithUser = <Result>(channel: string, respond: (argument: unknown, user: UserSummary) => Result) => void;

/**
 * Builds the sample ticket of the preview and of the test print: one product by the meter, one by the kilo and one by
 * the piece, paid in cash with change.
 *
 * @param businessName the name of the business
 * @returns the ticket
 */
export function sampleTicket(businessName: string): TicketData {
  return {
    businessName,
    folio: 'T1-000123',
    completedAt: new Date().toISOString(),
    lines: [
      { name: 'Cable calibre 12 rojo', quantity: quantityOf(3275, 'meter'), unitPriceE4: 125_000, totalCents: 4094 },
      { name: 'Clavo de 2 pulgadas', quantity: quantityOf(500, 'kilogram'), unitPriceE4: 480_000, totalCents: 2400 },
      { name: 'Foco LED 9 W', quantity: quantityOf(2000, 'piece'), unitPriceE4: 350_000, totalCents: 7000 },
    ],
    subtotalCents: 11_633,
    taxGroups: [{ taxRate: taxRateOf('rate', 1600), baseCents: 11_633, taxCents: 1861 }],
    totalCents: 13_494,
    payments: [{ method: 'cash', amountCents: 15_000, reference: null }],
    changeCents: 1506,
    isReprint: false,
  };
}

/**
 * Registers the handlers of the register tools: the keys, the ticket, the printer and the list of sales.
 *
 * @param answerSignedIn registers a handler that needs a person signed in
 * @param refuse builds the error for a person who may not do something
 * @param services what the handlers use
 */
export function registerToolsHandlers(
  answerSignedIn: AnswerSignedInWithUser,
  refuse: (message: string) => Error,
  { store, history, printer, audit, businessName }: ToolsServices,
): void {
  const requireOwner = (user: UserSummary): void => {
    if (user.role !== 'owner') {
      throw refuse('Only the owner can change the settings of the register');
    }
  };
  const requireDesign = (value: unknown): TicketDesign => {
    if (!isTicketDesign(value)) {
      throw new TypeError('Expected a complete ticket design with allowed values');
    }
    return value;
  };

  answerSignedIn(TOOLS_CHANNELS.getKeymap, (): Keymap => store.keymap());
  answerSignedIn(TOOLS_CHANNELS.saveKeymap, (value, user): void => {
    requireOwner(user);
    if (!isKeymap(value)) {
      throw new TypeError('Expected a key for every action, each one usable, and no key twice');
    }
    store.saveKeymap(value);
  });

  answerSignedIn(TOOLS_CHANNELS.getTicketDesign, (): TicketDesign => store.ticketDesign());
  answerSignedIn(TOOLS_CHANNELS.saveTicketDesign, (value, user): void => {
    requireOwner(user);
    store.saveTicketDesign(requireDesign(value));
  });
  answerSignedIn(TOOLS_CHANNELS.previewTicket, (value): string[] => {
    const design = requireDesign(value);
    return composeTicket(sampleTicket(businessName()), design).map((part) =>
      part.align === 'center' ? center(part.text, part.big ? Math.floor(design.columns / 2) : design.columns) : part.text,
    );
  });

  answerSignedIn(TOOLS_CHANNELS.getPrinter, (): string => store.printerShare());
  answerSignedIn(TOOLS_CHANNELS.savePrinter, (value, user): SavePrinterResult => {
    requireOwner(user);
    const share = typeof value === 'string' && value.length <= 200 ? normalizePrinterShare(value) : null;
    if (share === null) {
      return { status: 'invalid' };
    }
    store.savePrinterShare(share);
    return { status: 'saved', share };
  });
  answerSignedIn(TOOLS_CHANNELS.testPrint, async (_, user): Promise<TestPrintResult> => {
    requireOwner(user);
    if (!printer.isConfigured()) {
      return { status: 'no_printer' };
    }
    try {
      await printer.print(renderTicket(sampleTicket(businessName()), { ...store.ticketDesign(), copies: 1 }));
      return { status: 'printed' };
    } catch (error) {
      return { status: 'failed', message: error instanceof DeviceError ? error.message : String(error) };
    }
  });

  answerSignedIn(TOOLS_CHANNELS.listRecentSales, (text): SaleSummary[] => {
    if (typeof text !== 'string' || text.length > MAX_SEARCH_LENGTH) {
      throw new TypeError(`Expected a text of at most ${MAX_SEARCH_LENGTH} characters`);
    }
    return history.list(text);
  });
  answerSignedIn(TOOLS_CHANNELS.recordSaleCancelled, (value, user): void => {
    const { lineCount, totalCents } = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
    const isCount = typeof lineCount === 'number' && Number.isInteger(lineCount) && lineCount >= 1 && lineCount <= MAX_SALE_LINES;
    const isTotal = typeof totalCents === 'number' && Number.isSafeInteger(totalCents) && totalCents >= 0 && totalCents <= MAX_TOTAL_CENTS;
    if (!isCount || !isTotal) {
      throw new TypeError('Expected how many lines and how many cents the dropped sale had');
    }
    audit.record({
      userId: user.id,
      action: 'sale.dropped_before_payment',
      entity: 'sale',
      entityId: UNSAVED_SALE_ID,
      detail: `${String(lineCount)} lines, ${String(totalCents)} cents, dropped before it was charged`,
    });
  });
}

function center(text: string, width: number): string {
  const length = [...text].length;
  return length >= width ? text : `${' '.repeat(Math.floor((width - length) / 2))}${text}`;
}
