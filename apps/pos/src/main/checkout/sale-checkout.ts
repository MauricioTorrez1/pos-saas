import { DeviceError, type DeviceName } from '../hardware/device-error';
import type { RegisterHardware } from '../hardware/register-hardware';
import type { RecordedPayment, SaleRecorder, SaleToCheckout } from './sale-recorder';

/** A device that failed after the sale was completed. The sale stands; the cashier only needs to know. */
export interface DeviceProblem {
  readonly device: DeviceName;
  readonly message: string;
}

/** How a checkout ended. */
export type CheckoutResult =
  | { readonly status: 'completed'; readonly payment: RecordedPayment; readonly problems: readonly DeviceProblem[] }
  | { readonly status: 'declined'; readonly reason: string };

/** What checkout needs. The main process passes the real devices or the fakes; checkout cannot tell them apart. */
export interface CheckoutDependencies {
  readonly hardware: Pick<RegisterHardware, 'printer' | 'cashDrawer' | 'cardTerminal'>;
  readonly sales: SaleRecorder;
  /** Builds the ticket bytes once the payment is known. E1-13 brings the ESC/POS generator. */
  readonly renderTicket: (sale: SaleToCheckout, payment: RecordedPayment) => Uint8Array;
}

/**
 * Collects a sale and drives the devices in the order of ADR 0010: save it as pending, charge, mark it
 * completed, open the drawer, and print. This is what the screen will ask for through the bridge, so the
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
   * @throws RangeError if the total is not a positive integer of cents
   * @throws SaleAlreadyCompletedError if the sale was already completed, before charging anything
   * @throws DeviceError if the card terminal cannot be reached. The sale stays pending, because the charge may
   * have happened.
   */
  async checkout(sale: SaleToCheckout): Promise<CheckoutResult> {
    assertPositiveCents(sale.totalCents);
    const { sales } = this.#dependencies;

    sales.savePendingPayment(sale);
    const payment = await this.#collect(sale);
    if (payment.status === 'declined') {
      return payment;
    }
    sales.markCompleted(sale.saleId, payment.recorded);

    // From here on the sale is completed. Throwing would tell the screen it failed, and the cashier could
    // charge the customer again, so device failures become problems to show instead.
    const problems: DeviceProblem[] = [];
    if (payment.recorded.method === 'cash') {
      await this.#tryDevice('cashDrawer', problems, () => this.#dependencies.hardware.cashDrawer.open());
    }
    await this.#tryDevice('printer', problems, () =>
      this.#dependencies.hardware.printer.print(this.#dependencies.renderTicket(sale, payment.recorded)),
    );
    return { status: 'completed', payment: payment.recorded, problems };
  }

  async #collect(
    sale: SaleToCheckout,
  ): Promise<{ status: 'paid'; recorded: RecordedPayment } | { status: 'declined'; reason: string }> {
    if (sale.paymentMethod === 'cash') {
      return { status: 'paid', recorded: { method: 'cash' } };
    }
    const outcome = await this.#dependencies.hardware.cardTerminal.charge({
      saleId: sale.saleId,
      idempotencyKey: sale.idempotencyKey,
      amountCents: sale.totalCents,
    });
    return outcome.status === 'approved'
      ? { status: 'paid', recorded: { method: 'card', authorizationCode: outcome.authorizationCode } }
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
