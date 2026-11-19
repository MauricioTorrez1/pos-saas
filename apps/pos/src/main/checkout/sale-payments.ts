import { planPayments, type PlannedPayment } from '../../shared/payment-plan';
import type { CheckoutSaleResult, PaymentRequest, PrintTicketResult, ReprintResult, SaleTicketState } from '../../shared/pos-api';
import { DeviceError } from '../hardware/device-error';
import type { PrinterProvider } from '../hardware/printer-provider';
import type { SaleStore } from '../local-store/sale-store';
import { SaleNotFoundError } from '../local-store/sale-store';
import type { SaleCheckout } from './sale-checkout';
import type { CompletedSaleRecord, SalePayment, SaleToSave } from './sale-recorder';
import type { TicketPrintLog } from './ticket-print-log';
import { DEFAULT_TICKET_DESIGN, type TicketDesign } from '../../shared/register-tools';
import { renderTicket, formatFolio } from './ticket/ticket';
import { toTicketData } from './ticket/ticket-data';

type SaleReader = Pick<SaleStore, 'findPendingSale' | 'findLastCompletedSale' | 'findCompletedSale' | 'markCompleted'>;

/** What a reprint needs besides the sales. */
export interface ReprintDependencies {
  readonly printer: PrinterProvider;
  /** The name printed at the top of the ticket. */
  readonly businessName: () => string;
  /** How the ticket looks and when it prints. Without it, the ticket is the plain one and the register asks. */
  readonly ticketDesign?: () => TicketDesign;
  /** Remembers whether each sale had its ticket printed. Without it, nothing is remembered and every sale counts as printed. */
  readonly printLog?: Pick<TicketPrintLog, 'recordNotPrinted' | 'recordPrinted' | 'wasPrinted'>;
}

/** The sale whose ticket waits for the cashier to answer, with the change it gave, which is not kept anywhere else. */
interface AwaitingTicket {
  readonly saleId: string;
  readonly changeCents: number;
}

type TicketToPrint = { readonly status: 'printed' } | { readonly status: 'printer_failed'; readonly message: string };

/**
 * Collects the sales the screen saved before charging (ADR 0010). It does not trust the screen: the payments are worked
 * out again here from the saved total, so a sale cannot complete with payments that do not add up (invariant 5).
 */
export class SalePayments {
  readonly #sales: SaleReader;
  readonly #checkout: Pick<SaleCheckout, 'checkout'>;
  readonly #reprint: ReprintDependencies;
  #awaiting: AwaitingTicket | null = null;

  /**
   * @param sales where the saved sales are read from and completed
   * @param checkout drives the drawer and the printer once the sale is completed
   * @param reprint the printer and the business name, for printing a ticket again
   */
  constructor(sales: SaleReader, checkout: Pick<SaleCheckout, 'checkout'>, reprint: ReprintDependencies) {
    this.#sales = sales;
    this.#checkout = checkout;
    this.#reprint = reprint;
  }

  /**
   * Completes a saved sale with what the customer handed over and opens the drawer if there was cash. The ticket prints
   * now, waits for the cashier to answer, or never prints, as the owner chose (ADR 0075); the sale is saved either way.
   *
   * @param request the sale and what the customer handed over
   * @returns `completed` with the folio, the change and what happened to the ticket, or `payment_refused` with nothing recorded
   * @throws SaleNotFoundError if the sale does not exist or is no longer pending
   */
  async checkout(request: PaymentRequest): Promise<CheckoutSaleResult> {
    const sale = this.#requirePending(request.saleId);
    const plan = planPayments(sale.totalCents, request);
    if (plan.status !== 'ready') {
      return { status: 'payment_refused', plan };
    }
    const policy = this.#design().printPolicy;
    const result = await this.#checkout.checkout(
      { ...sale, payment: { kind: 'in_person', payments: plan.payments.map(toSalePayment), changeCents: plan.changeCents } },
      { printTicket: policy === 'always' },
    );
    if (result.status !== 'completed') {
      // Only a card can be declined, and this path never charges one.
      throw new Error(`Checkout of sale ${sale.saleId} was declined without a card: ${result.reason}`);
    }
    const printerFailed = result.problems.some(({ device }) => device === 'printer');
    const ticket = this.#afterCheckout(sale.saleId, policy, result.changeCents, printerFailed);
    return { status: 'completed', folio: formatFolio(result.folio), changeCents: result.changeCents, problems: result.problems, ticket };
  }

  #afterCheckout(saleId: string, policy: TicketDesign['printPolicy'], changeCents: number, printerFailed: boolean): SaleTicketState {
    switch (policy) {
      case 'always':
        if (printerFailed) {
          this.#reprint.printLog?.recordNotPrinted(saleId, 'printer_failed');
          return 'not_printed';
        }
        this.#reprint.printLog?.recordPrinted(saleId, false);
        return 'printed';
      case 'ask':
        // Written before the answer, so a sale whose question was never answered still reads as without its ticket.
        this.#reprint.printLog?.recordNotPrinted(saleId, 'awaiting_answer');
        this.#awaiting = { saleId, changeCents };
        return 'ask';
      case 'never':
        this.#reprint.printLog?.recordNotPrinted(saleId, 'policy_never');
        return 'not_printed';
    }
  }

  /**
   * Completes a sale that was left pending by a power cut. The customer already left, so the drawer stays closed and
   * nothing is printed.
   *
   * @param request the sale and what the customer paid it with
   * @returns `completed`, or `payment_refused` with nothing recorded
   * @throws SaleNotFoundError if the sale does not exist or is no longer pending
   */
  confirm(request: PaymentRequest): CheckoutSaleResult {
    const sale = this.#requirePending(request.saleId);
    const plan = planPayments(sale.totalCents, request);
    if (plan.status !== 'ready') {
      return { status: 'payment_refused', plan };
    }
    const { folio } = this.#sales.markCompleted(sale.saleId, plan.payments.map(toSalePayment));
    this.#reprint.printLog?.recordNotPrinted(sale.saleId, 'recovered_sale');
    return { status: 'completed', folio: formatFolio(folio), changeCents: plan.changeCents, problems: [], ticket: 'not_printed' };
  }

  /**
   * Prints the ticket of the last completed sale again. It is marked as a reprint when the sale already had its ticket;
   * a sale recorded without one prints its first ticket. The change is left out, because it is not kept and a reprint
   * must not invent it.
   *
   * @returns `printed`, `no_sales` if nothing was completed yet, or `printer_failed` if the printer did not take it
   */
  async reprintLast(): Promise<ReprintResult> {
    const last = this.#sales.findLastCompletedSale();
    if (last === null) {
      return { status: 'no_sales' };
    }
    return this.#printAndDescribe(last);
  }

  /**
   * Prints the ticket of one completed sale: the cashier said «Imprimir» after the sale, or asked for it from the history
   * (ADR 0075). Right after the sale the ticket carries the change, as if it had printed then.
   *
   * @param saleId the sale
   * @returns `printed`, `not_found` if the sale is not completed, or `printer_failed` if the printer did not take it
   */
  async printTicket(saleId: string): Promise<PrintTicketResult> {
    const record = this.#sales.findCompletedSale(saleId);
    return record === null ? { status: 'not_found' } : this.#printAndDescribe(record);
  }

  async #printAndDescribe(record: CompletedSaleRecord): Promise<Extract<PrintTicketResult, { folio: string }>> {
    const folio = formatFolio(record.folio);
    const printed = await this.#print(record);
    return printed.status === 'printed' ? { status: 'printed', folio } : { status: 'printer_failed', folio, message: printed.message };
  }

  /** Prints one ticket of a completed sale and records it. The answer to the question is the first ticket, with its change. */
  async #print(record: CompletedSaleRecord): Promise<TicketToPrint> {
    const saleId = record.sale.saleId;
    const awaiting = this.#awaiting?.saleId === saleId ? this.#awaiting : null;
    const isReprint = awaiting === null && (this.#reprint.printLog?.wasPrinted(saleId) ?? true);
    const design = this.#design();
    const ticket = toTicketData(this.#reprint.businessName(), record.sale, {
      folio: record.folio,
      completedAt: record.completedAt,
      payments: record.payments,
      changeCents: awaiting?.changeCents ?? null,
      isReprint,
    });
    try {
      // A reprint is one ticket, however many copies a sale prints; the first ticket of a sale prints all its copies.
      await this.#reprint.printer.print(renderTicket(ticket, isReprint ? { ...design, copies: 1 } : design));
    } catch (error) {
      return { status: 'printer_failed', message: error instanceof DeviceError ? error.message : String(error) };
    }
    if (awaiting !== null) {
      this.#awaiting = null;
    }
    this.#reprint.printLog?.recordPrinted(saleId, isReprint);
    return { status: 'printed' };
  }

  #design(): TicketDesign {
    return this.#reprint.ticketDesign?.() ?? DEFAULT_TICKET_DESIGN;
  }

  #requirePending(saleId: string): SaleToSave {
    const sale = this.#sales.findPendingSale(saleId);
    if (sale === null) {
      throw new SaleNotFoundError(saleId);
    }
    return sale;
  }
}

function toSalePayment(payment: PlannedPayment): SalePayment {
  return {
    method: payment.method,
    amountCents: payment.amountCents,
    reference: payment.method === 'cash' ? null : payment.reference,
  };
}
