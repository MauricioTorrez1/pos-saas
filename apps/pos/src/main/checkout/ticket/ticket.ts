import { formatCents, formatUnitPriceE4, type Quantity, type TaxGroup, type TaxRate } from '@pos-saas/money';

import type { SalePayment } from '../sale-recorder';
import { EscPosBuilder } from './escpos';

/** Characters per line on 80 mm paper with the standard font of an Epson TM-T20. */
export const TICKET_COLUMNS = 48;

/** The code of this register in the folio, until F0-15 registers each register with the server. */
const PROVISIONAL_REGISTER_CODE = 'T1';
const FOLIO_DIGITS = 6;
const MILLI_PER_UNIT = 1000;
const QUANTITY_DECIMALS = 3;
const BASIS_POINTS_PER_PERCENT = 100;
const FEED_BEFORE_CUT = 4;

const MOMENT_FORMAT = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' });

const UNIT_LABELS = { piece: 'pza', meter: 'm', kilogram: 'kg', liter: 'L' } as const;

/** One product line of the ticket. */
export interface TicketLine {
  readonly name: string;
  readonly quantity: Quantity;
  /** Price per unit with VAT, in ten-thousandths of a peso. */
  readonly unitPriceE4: number;
  /** What the customer paid for the line, in cents. */
  readonly totalCents: number;
}

/** Everything a ticket shows. It does not know where it came from, so a sale and its reprint look the same. */
export interface TicketData {
  readonly businessName: string;
  /** The short folio the customer can read out, such as `T1-000123`. */
  readonly folio: string;
  /** When the sale was completed, in ISO 8601. */
  readonly completedAt: string;
  readonly lines: readonly TicketLine[];
  readonly subtotalCents: number;
  readonly taxGroups: readonly TaxGroup[];
  readonly totalCents: number;
  readonly payments: readonly SalePayment[];
  /** Cash given back, or null when it is not known, as in a reprint. */
  readonly changeCents: number | null;
  readonly isReprint: boolean;
}

/**
 * Writes the short folio of a sale. It is short on purpose: the customer reads it out to ask for an invoice or a return,
 * and a UUID cannot be read out loud.
 *
 * @param folioNumber the number of the sale in this register, starting at 1
 * @returns text such as `T1-000123`
 * @throws RangeError if the number is not a positive integer
 */
export function formatFolio(folioNumber: number): string {
  if (!Number.isSafeInteger(folioNumber) || folioNumber < 1) {
    throw new RangeError(`A folio number must be a positive integer, got ${folioNumber}`);
  }
  return `${PROVISIONAL_REGISTER_CODE}-${String(folioNumber).padStart(FOLIO_DIGITS, '0')}`;
}

/**
 * Lays the ticket out as lines of text that fit the paper, before they become bytes.
 *
 * @param ticket what the ticket shows
 * @returns the lines. The first one is the name of the business, and none passes `TICKET_COLUMNS` characters.
 */
export function layoutTicket(ticket: TicketData): string[] {
  const lines: string[] = [fit(ticket.businessName, TICKET_COLUMNS), `Folio ${ticket.folio}`, MOMENT_FORMAT.format(new Date(ticket.completedAt))];
  if (ticket.isReprint) {
    lines.push('REIMPRESIÓN');
  }
  lines.push(rule());
  for (const line of ticket.lines) {
    lines.push(twoColumns(line.name, formatCents(line.totalCents)));
    lines.push(`  ${formatQuantity(line.quantity)} x ${formatUnitPriceE4(line.unitPriceE4)}`);
  }
  lines.push(rule(), twoColumns('Subtotal', formatCents(ticket.subtotalCents)));
  for (const group of ticket.taxGroups) {
    lines.push(twoColumns(taxLabel(group.taxRate), group.taxRate.factor === 'exempt' ? 'Sin IVA' : formatCents(group.taxCents)));
  }
  lines.push(twoColumns('TOTAL', formatCents(ticket.totalCents)), rule());
  for (const payment of ticket.payments) {
    lines.push(twoColumns(paymentLabel(payment), formatCents(payment.amountCents)));
  }
  if (ticket.changeCents !== null && ticket.changeCents > 0) {
    lines.push(twoColumns('Cambio', formatCents(ticket.changeCents)));
  }
  return lines;
}

/**
 * Builds the bytes the printer understands for a ticket. The same sale always gives the same bytes.
 *
 * @param ticket what the ticket shows
 * @returns the ESC/POS job: it resets the printer, prints the ticket, and cuts the paper
 */
export function renderTicket(ticket: TicketData): Uint8Array {
  const [name, ...rest] = layoutTicket(ticket);
  const builder = new EscPosBuilder().initialize().align('center').bold(true).line(name!).bold(false);
  const headerLines = ticket.isReprint ? 3 : 2;
  rest.slice(0, headerLines).forEach((line) => builder.line(line));
  builder.align('left');
  rest.slice(headerLines).forEach((line) => builder.line(line));
  return builder.align('center').line('Gracias por su compra').feed(FEED_BEFORE_CUT).cut().toBytes();
}

function rule(): string {
  return '-'.repeat(TICKET_COLUMNS);
}

/** Cuts a text that does not fit, so a long product name never pushes its amount to the next line. */
function fit(text: string, width: number): string {
  const characters = [...text];
  return characters.length <= width ? text : characters.slice(0, width).join('');
}

/** Puts the text at the left and the amount at the right edge of the paper. */
function twoColumns(left: string, right: string): string {
  const room = Math.max(TICKET_COLUMNS - [...right].length - 1, 0);
  const shown = fit(left, room);
  return `${shown}${' '.repeat(TICKET_COLUMNS - [...shown].length - [...right].length)}${right}`;
}

function formatQuantity({ milli, unit }: Quantity): string {
  const thousandths = milli % MILLI_PER_UNIT;
  const whole = (milli - thousandths) / MILLI_PER_UNIT;
  const number = unit === 'piece' ? String(whole) : `${whole}.${String(thousandths).padStart(QUANTITY_DECIMALS, '0')}`;
  return `${number} ${UNIT_LABELS[unit]}`;
}

function taxLabel({ factor, rateBp }: TaxRate): string {
  if (factor === 'exempt') {
    return 'Exento';
  }
  const remainder = rateBp % BASIS_POINTS_PER_PERCENT;
  const percent = (rateBp - remainder) / BASIS_POINTS_PER_PERCENT;
  return remainder === 0 ? `IVA ${percent}%` : `IVA ${percent}.${String(remainder).padStart(2, '0').replace(/0$/, '')}%`;
}

function paymentLabel({ method, reference }: SalePayment): string {
  switch (method) {
    case 'cash':
      return 'Efectivo';
    case 'transfer':
      return `Transferencia ${reference ?? ''}`.trim();
    case 'card':
    case 'card_manual':
      return `Tarjeta folio ${reference ?? ''}`.trim();
  }
}
