import type { CashDrawer } from '../cash-drawer';
import { DeviceError } from '../device-error';
import { CallLog } from './call-log';
import { NextFailure } from './next-failure';

/** A cash drawer that counts how many times it opened. */
export class RecordingCashDrawer implements CashDrawer {
  #openCount = 0;
  readonly #log: CallLog;
  readonly #nextFailure = new NextFailure();

  /** @param log where the call is recorded, shared with other fakes to check the order of a sale */
  constructor(log: CallLog = new CallLog()) {
    this.#log = log;
  }

  /** Counts one opening. A failed opening is recorded as an attempt in the log, but not counted. */
  async open(): Promise<void> {
    this.#log.record('cashDrawer.open');
    this.#nextFailure.throwIfArmed();
    this.#openCount += 1;
  }

  /** How many times the drawer really opened. */
  get openCount(): number {
    return this.#openCount;
  }

  /**
   * Makes the next opening fail, as an unplugged drawer would.
   *
   * @param error what that opening throws
   */
  failNextWith(error: Error = new DeviceError('cashDrawer', 'The cash drawer did not respond')): void {
    this.#nextFailure.arm(error);
  }
}
