import { formatCents, formatUnitPriceE4, type Quantity, type TaxGroup, type TaxRate } from '@pos-saas/money';

import { DEFAULT_TICKET_DESIGN, TEXT_SIZE_SCALE, ticketLineWidth, withCurrency, type TicketDesign } from '../../../shared/register-tools';
import { backdatedTicketLine, captureDayLabel } from '../../../shared/capture-day';
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
  /** The past day a backdated capture put the sale on, or null (or absent) for a sale of the day it was rung up (E1-60). */
  readonly backdatedDay?: string | null;
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

/** One printed line of a ticket, with how the printer sets it. */
export interface TicketPart {
  readonly text: string;
  readonly align: 'left' | 'center';
  readonly bold: boolean;
  /** Twice as wide as the rest of the ticket. A big line holds half the characters. */
  readonly big: boolean;
}

/**
 * Lays out a ticket as the lines the printer prints, with the design of the owner (ADR 0061).
 *
 * @param ticket what was sold and how it was paid
 * @param design how the ticket looks
 * @returns every line in order, from the name of the business to the foot
 */
export function composeTicket(ticket: TicketData, design: TicketDesign = DEFAULT_TICKET_DESIGN): TicketPart[] {
  const width = ticketLineWidth(design);
  const centered = (text: string, bold = false): TicketPart => ({ text: fit(text, width), align: 'center', bold, big: false });
  const left = (text: string): TicketPart => ({ text, align: 'left', bold: false, big: false });
  const money = (amountCents: number): string => withCurrency(formatCents(amountCents), design.currency);
  const name = design.businessName.trim() === '' ? ticket.businessName : design.businessName.trim();
  const parts: TicketPart[] = [centered(name, true)];
  design.headerLines.filter((line) => line.trim() !== '').forEach((line) => parts.push(centered(line)));
  parts.push(centered(`Folio ${ticket.folio}`), centered(MOMENT_FORMAT.format(new Date(ticket.completedAt))));
  if (ticket.backdatedDay != null) {
    // A narrow paper breaks the line before the day, so the day is never cut off.
    const line = backdatedTicketLine(ticket.backdatedDay);
    const lines = line.length <= width ? [line] : ['Captura atrasada del', captureDayLabel(ticket.backdatedDay)];
    lines.forEach((text) => parts.push(centered(text, true)));
  }
  if (ticket.isReprint) {
    parts.push(centered('REIMPRESIÓN'));
  }
  parts.push(left(rule(width)));
  for (const line of ticket.lines) {
    if (design.showUnitPrice) {
      parts.push(left(twoColumns(line.name, money(line.totalCents), width)));
      parts.push(left(`  ${formatQuantity(line.quantity)} x ${withCurrency(formatUnitPriceE4(line.unitPriceE4), design.currency)}`));
    } else {
      parts.push(left(twoColumns(`${formatQuantity(line.quantity)} ${line.name}`, money(line.totalCents), width)));
    }
  }
  parts.push(left(rule(width)));
  if (design.showTaxBreakdown) {
    parts.push(left(twoColumns('Subtotal', money(ticket.subtotalCents), width)));
    for (const group of ticket.taxGroups) {
      parts.push(left(twoColumns(taxLabel(group.taxRate), group.taxRate.factor === 'exempt' ? 'Sin IVA' : money(group.taxCents), width)));
    }
  }
  parts.push(
    design.bigTotal
      ? { text: twoColumns('TOTAL', money(ticket.totalCents), ticketLineWidth(design, true)), align: 'left', bold: true, big: true }
      : left(twoColumns('TOTAL', money(ticket.totalCents), width)),
    left(rule(width)),
  );
  for (const payment of ticket.payments) {
    parts.push(left(twoColumns(paymentLabel(payment), money(payment.amountCents), width)));
  }
  if (ticket.changeCents !== null && ticket.changeCents > 0) {
    parts.push(left(twoColumns('Cambio', money(ticket.changeCents), width)));
  }
  design.footerLines.filter((line) => line.trim() !== '').forEach((line) => parts.push(centered(line)));
  return parts;
}

/**
 * Lays out the body of a ticket as plain text, without the foot. Kept for what reads a ticket as text.
 *
 * @param ticket what was sold and how it was paid
 * @param design how the ticket looks
 * @returns the lines from the name of the business to the change
 */
export function layoutTicket(ticket: TicketData, design: TicketDesign = DEFAULT_TICKET_DESIGN): string[] {
  const footers = design.footerLines.filter((line) => line.trim() !== '').length;
  const parts = composeTicket(ticket, design);
  return parts.slice(0, parts.length - footers).map((part) => part.text);
}

/**
 * Turns a ticket into the bytes the printer understands (ESC/POS).
 *
 * @param ticket what was sold and how it was paid
 * @param design how the ticket looks; without it, the ticket is the plain one
 * @returns one print job with as many tickets as the design asks for, each one cut
 */
export function renderTicket(ticket: TicketData, design: TicketDesign = DEFAULT_TICKET_DESIGN): Uint8Array {
  return renderParts(() => composeTicket(ticket, design), design, design.copies);
}

/**
 * Turns laid-out lines into the bytes the printer understands (ESC/POS), with the font and size of the design. A sale
 * ticket and a quote (F2-07) print the same way.
 *
 * @param compose lays out the lines of one copy
 * @param design how the ticket looks
 * @param copies how many copies to print, each one cut
 * @returns one print job
 */
export function renderParts(compose: () => readonly TicketPart[], design: TicketDesign, copies: number): Uint8Array {
  const builder = new EscPosBuilder().initialize();
  const base = TEXT_SIZE_SCALE[design.textSize];
  // The big total is twice as wide as the rest, and at least twice as tall as a normal letter.
  const big = { width: base.width * 2, height: Math.max(base.height, base.width * 2) };
  if (design.font === 'b') {
    builder.font('b');
  }
  if (design.textSize !== 'normal') {
    builder.textSize(base.width, base.height);
  }
  for (let copy = 0; copy < copies; copy += 1) {
    let align: TicketPart['align'] | null = null;
    for (const part of compose()) {
      if (part.align !== align) {
        builder.align(part.align);
        align = part.align;
      }
      if (part.big) {
        builder.textSize(big.width, big.height);
      }
      if (part.bold) {
        builder.bold(true);
      }
      builder.line(part.text);
      if (part.bold) {
        builder.bold(false);
      }
      if (part.big) {
        builder.textSize(base.width, base.height);
      }
    }
    builder.feed(FEED_BEFORE_CUT).cut();
  }
  return builder.toBytes();
}

/** @returns a line of dashes as wide as the paper */
export function rule(width: number): string {
  return '-'.repeat(width);
}

/** @returns the text cut to the width */
export function fit(text: string, width: number): string {
  const characters = [...text];
  return characters.length <= width ? text : characters.slice(0, width).join('');
}

/** @returns the left text and the right text on one line, the right one flush with the edge */
export function twoColumns(left: string, right: string, width: number): string {
  const room = Math.max(width - [...right].length - 1, 0);
  const shown = fit(left, room);
  return `${shown}${' '.repeat(Math.max(width - [...shown].length - [...right].length, 1))}${right}`;
}

/** @returns a quantity as the ticket prints it, such as `2 pza` or `3.250 m` */
export function formatQuantity({ milli, unit }: Quantity): string {
  const thousandths = milli % MILLI_PER_UNIT;
  const whole = (milli - thousandths) / MILLI_PER_UNIT;
  const number = unit === 'piece' ? String(whole) : `${whole}.${String(thousandths).padStart(QUANTITY_DECIMALS, '0')}`;
  return `${number} ${UNIT_LABELS[unit]}`;
}

/** @returns the name of a VAT rate, such as `IVA 16%` */
export function taxLabel({ factor, rateBp }: TaxRate): string {
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
