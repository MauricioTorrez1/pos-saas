import { planPayments, type PlannedPayment } from '../../shared/payment-plan';
import type { CheckoutSaleResult, PaymentRequest } from '../../shared/pos-api';
import type { SaleStore } from '../local-store/sale-store';
import { SaleNotFoundError } from '../local-store/sale-store';
import type { SaleCheckout } from './sale-checkout';
import type { SalePayment, SaleToSave } from './sale-recorder';

/**
 * Collects the sales the screen saved before charging (ADR 0010). It does not trust the screen: the payments are worked
 * out again here from the saved total, so a sale cannot complete with payments that do not add up (invariant 5).
 */
export class SalePayments {
  readonly #sales: Pick<SaleStore, 'findPendingSale' | 'markCompleted'>;
  readonly #checkout: Pick<SaleCheckout, 'checkout'>;

  /**
   * @param sales where the saved sales are read from and completed
   * @param checkout drives the drawer and the printer once the sale is completed
   */
  constructor(sales: Pick<SaleStore, 'findPendingSale' | 'markCompleted'>, checkout: Pick<SaleCheckout, 'checkout'>) {
    this.#sales = sales;
    this.#checkout = checkout;
  }

  /**
   * Completes a saved sale with what the customer handed over, opens the drawer if there was cash, and prints the ticket.
   *
   * @param request the sale and what the customer handed over
   * @returns `completed` with the change, or `payment_refused` with nothing recorded
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
    return { status: 'completed', changeCents: result.changeCents, problems: result.problems };
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
    this.#sales.markCompleted(sale.saleId, plan.payments.map(toSalePayment));
    return { status: 'completed', changeCents: plan.changeCents, problems: [] };
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
    reference: payment.method === 'transfer' ? payment.reference : null,
  };
}
