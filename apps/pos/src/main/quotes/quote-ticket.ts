import { formatCents, formatUnitPriceE4, saleTotals } from '@pos-saas/money';

import { quoteDayLabel, type Quote } from '../../shared/quotes';
import { ticketLineWidth, withCurrency, type TicketDesign } from '../../shared/register-tools';
import { fit, formatQuantity, rule, taxLabel, twoColumns, type TicketPart } from '../checkout/ticket/ticket';

const MOMENT_FORMAT = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' });

/** Printed at the foot of every quote, so nobody takes it for a receipt. */
export const QUOTE_DISCLAIMER = ['Este documento no es una venta', 'ni un comprobante fiscal.', 'Precios sujetos a existencia.'] as const;

/**
 * Lays out a quote as the ticket printer prints it, with the design of the owner: the same paper, font and letters as a
 * sale ticket, under the heading «COTIZACIÓN», without payments and without the foot of the sale ticket.
 *
 * @param quote the quote, whole
 * @param businessName the name printed at the top when the design has none
 * @param design how the ticket looks
 * @param isReprint whether it was printed before
 * @returns every line in order
 */
export function composeQuoteTicket(quote: Quote, businessName: string, design: TicketDesign, isReprint: boolean): TicketPart[] {
  const width = ticketLineWidth(design);
  const centered = (text: string, bold = false): TicketPart => ({ text: fit(text, width), align: 'center', bold, big: false });
  const left = (text: string): TicketPart => ({ text, align: 'left', bold: false, big: false });
  const money = (amountCents: number): string => withCurrency(formatCents(amountCents), design.currency);
  const name = design.businessName.trim() === '' ? businessName : design.businessName.trim();
  const parts: TicketPart[] = [centered(name, true)];
  design.headerLines.filter((line) => line.trim() !== '').forEach((line) => parts.push(centered(line)));
  parts.push(centered('COTIZACIÓN', true), centered(`Folio ${quote.folio}`), centered(MOMENT_FORMAT.format(new Date(quote.createdAt))));
  parts.push(centered(`Válida hasta el ${quoteDayLabel(quote.validUntil)}`));
  if (isReprint) {
    parts.push(centered('REIMPRESIÓN'));
  }
  if (quote.customerName !== null) {
    parts.push(left(fit(`Cliente: ${quote.customerName}`, width)));
  }
  if (quote.customerPhone !== null) {
    parts.push(left(fit(`Teléfono: ${quote.customerPhone}`, width)));
  }
  parts.push(left(rule(width)));
  for (const line of quote.lines) {
    if (design.showUnitPrice) {
      parts.push(left(twoColumns(line.productName, money(line.totalCents), width)));
      parts.push(left(`  ${formatQuantity(line.quantity)} x ${withCurrency(formatUnitPriceE4(line.unitPriceE4), design.currency)}`));
    } else {
      parts.push(left(twoColumns(`${formatQuantity(line.quantity)} ${line.productName}`, money(line.totalCents), width)));
    }
  }
  parts.push(left(rule(width)));
  if (design.showTaxBreakdown) {
    const { subtotalCents, taxGroups } = saleTotals(quote.lines.map((line) => ({ totalCents: line.totalCents, taxRate: line.taxRate })));
    parts.push(left(twoColumns('Subtotal', money(subtotalCents), width)));
    for (const group of taxGroups) {
      parts.push(left(twoColumns(taxLabel(group.taxRate), group.taxRate.factor === 'exempt' ? 'Sin IVA' : money(group.taxCents), width)));
    }
  }
  parts.push(
    design.bigTotal
      ? { text: twoColumns('TOTAL', money(quote.totalCents), ticketLineWidth(design, true)), align: 'left', bold: true, big: true }
      : left(twoColumns('TOTAL', money(quote.totalCents), width)),
    left(rule(width)),
  );
  if (quote.notes !== null) {
    wrap(`Notas: ${quote.notes}`, width).forEach((text) => parts.push(left(text)));
    parts.push(left(rule(width)));
  }
  QUOTE_DISCLAIMER.forEach((text) => parts.push(centered(text)));
  return parts;
}

/** Breaks a long text into lines of the paper, between words when it can. */
function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/u)) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if ([...candidate].length <= width) {
      current = candidate;
      continue;
    }
    if (current !== '') {
      lines.push(current);
    }
    current = word;
    while ([...current].length > width) {
      lines.push([...current].slice(0, width).join(''));
      current = [...current].slice(width).join('');
    }
  }
  if (current !== '') {
    lines.push(current);
  }
  return lines;
}
