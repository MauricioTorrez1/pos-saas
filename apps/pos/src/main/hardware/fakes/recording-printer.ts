import { DeviceError } from '../device-error';
import type { PrinterProvider } from '../printer-provider';
import { CallLog } from './call-log';
import { NextFailure } from './next-failure';

/** A printer that keeps every byte it receives instead of putting it on paper. */
export class RecordingPrinter implements PrinterProvider {
  readonly #jobs: Uint8Array[] = [];
  readonly #log: CallLog;
  readonly #nextFailure = new NextFailure();

  /** @param log where the call is recorded, shared with other fakes to check the order of a sale */
  constructor(log: CallLog = new CallLog()) {
    this.#log = log;
  }

  /**
   * Keeps a copy of the job. A failed job is recorded as an attempt in the log, but not as printed.
   *
   * @param job raw ESC/POS bytes
   */
  async print(job: Uint8Array): Promise<void> {
    this.#log.record('printer.print');
    this.#nextFailure.throwIfArmed();
    // A copy, so a caller that reuses its buffer cannot change what was already printed.
    this.#jobs.push(Uint8Array.from(job));
  }

  /** Every printed job, in order. */
  get jobs(): readonly Uint8Array[] {
    return this.#jobs.map((job) => Uint8Array.from(job));
  }

  /**
   * Joins every printed job, as the roll of paper would show them.
   *
   * @returns all printed bytes, in order
   */
  printedBytes(): Uint8Array {
    const printed = new Uint8Array(this.#jobs.reduce((length, job) => length + job.length, 0));
    let offset = 0;
    for (const job of this.#jobs) {
      printed.set(job, offset);
      offset += job.length;
    }
    return printed;
  }

  /**
   * Makes the next job fail, as a printer without paper would.
   *
   * @param error what that job throws
   */
  failNextWith(error: Error = new DeviceError('printer', 'The printer is out of paper')): void {
    this.#nextFailure.arm(error);
  }
}
