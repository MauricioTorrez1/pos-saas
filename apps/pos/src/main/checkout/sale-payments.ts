import { planPayments, type PlannedPayment } from '../../shared/payment-plan';
import type { CheckoutSaleResult, PaymentRequest, ReprintResult } from '../../shared/pos-api';
import { DeviceError } from '../hardware/device-error';
import type { PrinterProvider } from '../hardware/printer-provider';
import type { SaleStore } from '../local-store/sale-store';
import { SaleNotFoundError } from '../local-store/sale-store';
import type { SaleCheckout } from './sale-checkout';
import type { SalePayment, SaleToSave } from './sale-recorder';
import { renderTicket, formatFolio } from './ticket/ticket';
import { toTicketData } from './ticket/ticket-data';

type SaleReader = Pick<SaleStore, 'findPendingSale' | 'findLastCompletedSale' | 'markCompleted'>;

/** What a reprint needs besides the sales. */
export interface ReprintDependencies {
  readonly printer: PrinterProvider;
  /** The name printed at the top of the ticket. */
  readonly businessName: () => string;
}

/**
 * Collects the sales the screen saved before charging (ADR 0010). It does not trust the screen: the payments are worked
 * out again here from the saved total, so a sale cannot complete with payments that do not add up (invariant 5).
 */
export class SalePayments {
  readonly #sales: SaleReader;
  readonly #checkout: Pick<SaleCheckout, 'checkout'>;
  readonly #reprint: ReprintDependencies;

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
   * Completes a saved sale with what the customer handed over, opens the drawer if there was cash, and prints the ticket.
   *
   * @param request the sale and what the customer handed over
   * @returns `completed` with the folio and the change, or `payment_refused` with nothing recorded
   * @throws SaleNotFoundError if the sale does not exist or is no longer pending
   */
  async checkout(request: PaymentRequest): Promise<CheckoutSaleResult> {
    const sale = this.#requirePending(request.saleId);
    const plan = planPayments(sale.totalCents, request);
    if (plan.status !== 'ready') {
      return { status: 'payment_refused', plan };
    }
    const result = await this.#checkout.checkout({
      ...sale,
      payment: { kind: 'in_person', payments: plan.payments.map(toSalePayment), changeCents: plan.changeCents },
    });
    if (result.status !== 'completed') {
      // Only a card can be declined, and this path never charges one.
      throw new Error(`Checkout of sale ${sale.saleId} was declined without a card: ${result.reason}`);
    }
    return { status: 'completed', folio: formatFolio(result.folio), changeCents: result.changeCents, problems: result.problems };
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
    return { status: 'completed', folio: formatFolio(folio), changeCents: plan.changeCents, problems: [] };
  }

  /**
   * Prints the ticket of the last completed sale again, marked as a reprint. The change is left out, because it is not
   * kept and a reprint must not invent it.
   *
   * @returns `printed`, `no_sales` if nothing was completed yet, or `printer_failed` if the printer did not take it
   */
  async reprintLast(): Promise<ReprintResult> {
    const last = this.#sales.findLastCompletedSale();
    if (last === null) {
      return { status: 'no_sales' };
    }
    const folio = formatFolio(last.folio);
    const ticket = toTicketData(this.#reprint.businessName(), last.sale, {
      folio: last.folio,
      completedAt: last.completedAt,
      payments: last.payments,
      changeCents: null,
      isReprint: true,
    });
    try {
      await this.#reprint.printer.print(renderTicket(ticket));
    } catch (error) {
      return { status: 'printer_failed', folio, message: error instanceof DeviceError ? error.message : String(error) };
    }
    return { status: 'printed', folio };
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
