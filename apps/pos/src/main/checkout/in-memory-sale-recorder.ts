import { CallLog } from '../hardware/fakes/call-log';
import { NextFailure } from '../hardware/fakes/next-failure';
import { SaleAlreadyCompletedError, type CompletedSale, type SalePayment, type SaleRecorder, type SaleToSave } from './sale-recorder';

/** What the fake knows about one sale. */
export type RecordedSale =
  | { readonly status: 'pending_payment'; readonly sale: SaleToSave }
  | { readonly status: 'completed'; readonly sale: SaleToSave; readonly payments: readonly SalePayment[] };

/** Keeps sales in memory, so checkout can be tested with a save that fails on demand. */
export class InMemorySaleRecorder implements SaleRecorder {
  readonly #sales = new Map<string, RecordedSale>();
  readonly #log: CallLog;
  readonly #nextFailure = new NextFailure();
  #lastFolio = 0;

  /** @param log where the call is recorded, shared with the hardware fakes to check the order of a sale */
  constructor(log: CallLog = new CallLog()) {
    this.#log = log;
  }

  /** {@inheritDoc SaleRecorder.savePendingPayment} */
  savePendingPayment(sale: SaleToSave): void {
    this.#log.record('sales.savePendingPayment');
    this.#nextFailure.throwIfArmed();
    if (this.#sales.get(sale.saleId)?.status === 'completed') {
      throw new SaleAlreadyCompletedError(sale.saleId);
    }
    this.#sales.set(sale.saleId, { status: 'pending_payment', sale: { ...sale } });
  }

  /**
   * {@inheritDoc SaleRecorder.markCompleted}
   *
   * @throws Error if the sale is not pending, which would mean checkout skipped a step
   */
  markCompleted(saleId: string, payments: readonly SalePayment[]): CompletedSale {
    this.#log.record('sales.markCompleted');
    this.#nextFailure.throwIfArmed();
    const recorded = this.#sales.get(saleId);
    if (recorded?.status !== 'pending_payment') {
      throw new Error(`Sale ${saleId} must be pending to complete it, but it is ${recorded?.status ?? 'missing'}`);
    }
    this.#sales.set(saleId, { status: 'completed', sale: recorded.sale, payments: payments.map((payment) => ({ ...payment })) });
    this.#lastFolio += 1;
    return { folio: this.#lastFolio, completedAt: new Date().toISOString() };
  }

  /**
   * Reads what was saved for a sale.
   *
   * @param saleId the sale to look up
   * @returns its status and payments, or `undefined` if it was never saved
   */
  find(saleId: string): RecordedSale | undefined {
    return this.#sales.get(saleId);
  }

  /**
   * Makes the next call fail, as a full disk would.
   *
   * @param error what that call throws
   */
  failNextWith(error: Error): void {
    this.#nextFailure.arm(error);
  }
}
