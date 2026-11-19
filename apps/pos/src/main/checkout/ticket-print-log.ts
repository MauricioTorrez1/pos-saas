import type { StatementSync } from 'node:sqlite';

import type { AuditLog } from '../audit/audit-log';
import type { LocalStore } from '../local-store/local-store';

/** The audit action written when a sale is recorded without printing its ticket (E1-59, ADR 0075). */
export const TICKET_NOT_PRINTED_ACTION = 'sale.ticket_not_printed';
/** The audit action written every time a ticket of a sale reaches the printer. */
export const TICKET_PRINTED_ACTION = 'sale.ticket_printed';

/**
 * The SQL that tells whether the ticket of a sale was printed, for a query that reads the sale as `alias`. A sale with
 * no entry at all was printed: every sale before E1-59 printed its ticket right away.
 *
 * @param alias the alias of the `sale` table in the query
 * @returns a boolean SQL expression, 1 when the ticket was printed
 */
export function ticketPrintedSql(alias: string): string {
  const entry = (action: string): string =>
    `EXISTS (SELECT 1 FROM audit_log a WHERE a.tenant_id = ${alias}.tenant_id AND a.entity = 'sale' AND a.entity_id = ${alias}.id AND a.action = '${action}')`;
  return `(NOT ${entry(TICKET_NOT_PRINTED_ACTION)} OR ${entry(TICKET_PRINTED_ACTION)})`;
}

/** Why the ticket was not printed when the sale was recorded. */
export type NotPrintedReason = 'awaiting_answer' | 'policy_never' | 'printer_failed' | 'recovered_sale';

const NOT_PRINTED_DETAIL: Readonly<Record<NotPrintedReason, string>> = {
  awaiting_answer: 'Venta cobrada; se pregunta al cajero si imprime el ticket.',
  policy_never: 'Venta cobrada; la caja está configurada para no imprimir tickets.',
  printer_failed: 'Venta cobrada; la impresora no tomó el ticket.',
  recovered_sale: 'Venta confirmada después de un corte de luz; el cliente ya se había ido.',
};

/** What the log needs of the audit log and of who is signed in. */
export interface TicketPrintLogDependencies {
  readonly audit: Pick<AuditLog, 'record'>;
  /** The person at the register, or null when nobody is signed in. */
  readonly currentUserId: () => string | null;
}

/** Who an entry names when nobody is signed in, which only happens in tests: every sale needs a person. */
const NOBODY = 'register';

/**
 * Remembers whether the ticket of each sale was printed, in the audit log, so a sale never changes for it (ADR 0075).
 * The sale is immutable; whether paper came out is a fact about the sale, written next to it.
 */
export class TicketPrintLog {
  readonly #tenantId: string;
  readonly #dependencies: TicketPrintLogDependencies;
  readonly #wasPrinted: StatementSync;

  /**
   * @param store the open local database
   * @param tenantId the business whose sales these are
   * @param dependencies where the entries go and who is signed in
   */
  constructor(store: LocalStore, tenantId: string, dependencies: TicketPrintLogDependencies) {
    this.#tenantId = tenantId;
    this.#dependencies = dependencies;
    this.#wasPrinted = store.prepare(`SELECT ${ticketPrintedSql('s')} AS printed FROM sale s WHERE s.tenant_id = ? AND s.id = ?`);
  }

  /**
   * Writes that a sale was recorded without its ticket.
   *
   * @param saleId the sale
   * @param reason whether the cashier is being asked or the register never prints
   */
  recordNotPrinted(saleId: string, reason: NotPrintedReason): void {
    this.#record(TICKET_NOT_PRINTED_ACTION, saleId, NOT_PRINTED_DETAIL[reason]);
  }

  /**
   * Writes that a ticket of a sale reached the printer.
   *
   * @param saleId the sale
   * @param isReprint whether the sale had a ticket printed before
   */
  recordPrinted(saleId: string, isReprint: boolean): void {
    this.#record(TICKET_PRINTED_ACTION, saleId, isReprint ? 'Ticket reimpreso.' : 'Ticket impreso.');
  }

  /**
   * Tells whether a sale already had its ticket printed.
   *
   * @param saleId the sale
   * @returns false only when the sale was recorded without its ticket and none was printed since
   */
  wasPrinted(saleId: string): boolean {
    const row = this.#wasPrinted.get(this.#tenantId, saleId) as { printed: number } | undefined;
    return row === undefined || row.printed === 1;
  }

  #record(action: string, saleId: string, detail: string): void {
    this.#dependencies.audit.record({ userId: this.#dependencies.currentUserId() ?? NOBODY, action, entity: 'sale', entityId: saleId, detail });
  }
}
