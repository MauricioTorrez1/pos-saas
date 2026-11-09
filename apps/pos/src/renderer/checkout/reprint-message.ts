import type { ReprintResult } from '../../shared/pos-api';

/** What the cashier reads when the register cannot even ask the printer. */
export const REPRINT_FAILED = 'No se pudo reimprimir el ticket. Intenta de nuevo y, si sigue fallando, reinicia la caja.';

/**
 * Words the result of printing the last ticket again.
 *
 * @param result what the main process answered
 * @returns the message to show
 */
export function describeReprint(result: ReprintResult): string {
  switch (result.status) {
    case 'printed':
      return `Ticket ${result.folio} reimpreso.`;
    case 'no_sales':
      return 'Todavía no hay ventas cobradas para reimprimir.';
    case 'printer_failed':
      return `No se pudo imprimir el ticket ${result.folio}: ${result.message}. La venta quedó registrada.`;
  }
}
