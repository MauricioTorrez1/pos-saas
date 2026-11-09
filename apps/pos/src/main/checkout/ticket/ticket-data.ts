import { saleTotals } from '@pos-saas/money';

import type { SalePayment, SaleToSave } from '../sale-recorder';
import { formatFolio, type TicketData } from './ticket';

/** What turns a saved sale into a ticket. */
export interface TicketSource {
  readonly folio: number;
  readonly completedAt: string;
  readonly payments: readonly SalePayment[];
  /** Cash given back, or null when it is not known, as in a reprint. */
  readonly changeCents: number | null;
  readonly isReprint: boolean;
}

/**
 * Gathers what a ticket shows from a saved sale. The VAT is worked out again from the lines, so the ticket always
 * agrees with them (ADR 0023).
 *
 * @param businessName the name printed at the top
 * @param sale the sale, as it was saved
 * @param source its folio, its time, how it was paid, and whether this is a reprint
 * @returns the data for `renderTicket`
 */
export function toTicketData(businessName: string, sale: SaleToSave, source: TicketSource): TicketData {
  const { subtotalCents, taxGroups, totalCents } = saleTotals(
    sale.lines.map((line) => ({ totalCents: line.totals.totalCents, taxRate: line.totals.taxRate })),
  );
  return {
    businessName,
    folio: formatFolio(source.folio),
    completedAt: source.completedAt,
    lines: sale.lines.map((line) => ({
      name: line.productName,
      quantity: line.quantity,
      unitPriceE4: line.unitPriceE4,
      totalCents: line.totals.totalCents,
    })),
    subtotalCents,
    taxGroups,
    totalCents,
    payments: source.payments,
    changeCents: source.changeCents,
    isReprint: source.isReprint,
  };
}
