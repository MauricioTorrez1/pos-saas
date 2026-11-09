import { sumCents } from '@pos-saas/money';

import { DeviceError, type DeviceName } from '../hardware/device-error';
import type { RegisterHardware } from '../hardware/register-hardware';
import type { CompletedSale, SalePayment, SaleRecorder, SaleToCheckout } from './sale-recorder';

/** A device that failed after the sale was completed. The sale stands; the cashier only needs to know. */
export interface DeviceProblem {
  readonly device: DeviceName;
  readonly message: string;
}

/** How a checkout ended. */
export type CheckoutResult =
  | {
      readonly status: 'completed';
      /** What the sale was paid with. It adds up to the total. */
      readonly payments: readonly SalePayment[];
      /** The folio the sale got. */
      readonly folio: number;
      /** Cash given back to the customer. */
      readonly changeCents: number;
      readonly problems: readonly DeviceProblem[];
    }
  | { readonly status: 'declined'; readonly reason: string };

/** What checkout needs. The main process passes the real devices or the fakes; checkout cannot tell them apart. */
export interface CheckoutDependencies {
  readonly hardware: Pick<RegisterHardware, 'printer' | 'cashDrawer' | 'cardTerminal'>;
  readonly sales: SaleRecorder;
  /** Builds the ticket bytes once the sale is completed and has its folio. */
  readonly renderTicket: (sale: SaleToCheckout, receipt: Receipt) => Uint8Array;
}

/** What a ticket needs besides the sale: how it was paid, the change, and the folio it got. */
export interface Receipt extends CompletedSale {
  readonly payments: readonly SalePayment[];
  /** Cash given back. */
  readonly changeCents: number;
}

type Collected =
  | { readonly status: 'paid'; readonly payments: readonly SalePayment[]; readonly changeCents: number }
  | { readonly status: 'declined'; readonly reason: string };

/**
 * Collects a sale and drives the devices in the order of ADR 0010: save it as pending, charge, mark it
 * completed, open the drawer, and print. This is what the screen asks for through the bridge, so the
 * screen never gives orders to a device.
 */
export class SaleCheckout {
  readonly #dependencies: CheckoutDependencies;

  /** @param dependencies the devices, where sales are saved, and how tickets are built */
  constructor(dependencies: CheckoutDependencies) {
    this.#dependencies = dependencies;
  }

  /**
   * Collects one payment attempt for a sale.
   *
   * @param sale the sale, its attempt key, its total, and how the customer pays
   * @returns `completed` with any device problems after the sale was saved, or `declined` with the sale still pending
   * @throws RangeError if the total is not a positive integer of cents, or the payments do not add up to it. Nothing
   * is saved or charged in that case.
   * @throws SaleAlreadyCompletedError if the sale was already completed, before charging anything
   * @throws DeviceError if the card terminal cannot be reached. The sale stays pending, because the charge may
   * have happened.
   */
  async checkout(sale: SaleToCheckout): Promise<CheckoutResult> {
    assertPositiveCents(sale.totalCents);
    assertPaymentsCoverTotal(sale);
    const { sales } = this.#dependencies;

    sales.savePendingPayment(sale);
    const collected = await this.#collect(sale);
    if (collected.status === 'declined') {
      return collected;
    }
    const completed = sales.markCompleted(sale.saleId, collected.payments);

    // From here on the sale is completed. Throwing would tell the screen it failed, and the cashier could
    // charge the customer again, so device failures become problems to show instead.
    const problems: DeviceProblem[] = [];
    if (collected.payments.some(({ method }) => method === 'cash')) {
      await this.#tryDevice('cashDrawer', problems, () => this.#dependencies.hardware.cashDrawer.open());
    }
    await this.#tryDevice('printer', problems, () =>
      this.#dependencies.hardware.printer.print(this.#dependencies.renderTicket(sale, { ...completed, payments: collected.payments, changeCents: collected.changeCents })),
    );
    return { status: 'completed', payments: collected.payments, folio: completed.folio, changeCents: collected.changeCents, problems };
  }

  async #collect(sale: SaleToCheckout): Promise<Collected> {
    if (sale.payment.kind === 'in_person') {
      return { status: 'paid', payments: sale.payment.payments, changeCents: sale.payment.changeCents };
    }
    const outcome = await this.#dependencies.hardware.cardTerminal.charge({
      saleId: sale.saleId,
      idempotencyKey: sale.idempotencyKey,
      amountCents: sale.totalCents,
    });
    return outcome.status === 'approved'
      ? {
          status: 'paid',
          payments: [{ method: 'card', amountCents: sale.totalCents, reference: outcome.authorizationCode }],
          changeCents: 0,
        }
      : outcome;
  }

  async #tryDevice(device: DeviceName, problems: DeviceProblem[], use: () => Promise<void>): Promise<void> {
    try {
      await use();
    } catch (error) {
      problems.push({ device, message: error instanceof DeviceError ? error.message : String(error) });
    }
  }
}

function assertPositiveCents(totalCents: number): void {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0) {
    throw new RangeError(`A sale total must be a positive integer of cents, got ${totalCents}`);
  }
}

/** The invariant that matters most for the cash-up: checked before anything is saved, as the database does after. */
function assertPaymentsCoverTotal({ payment, totalCents }: SaleToCheckout): void {
  if (payment.kind !== 'in_person') {
    return;
  }
  const paidCents = sumCents(payment.payments.map(({ amountCents }) => amountCents));
  if (paidCents !== totalCents) {
    throw new RangeError(`The payments add up to ${paidCents} cents, but the sale total is ${totalCents}`);
  }
}
