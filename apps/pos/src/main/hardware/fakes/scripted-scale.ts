import { DeviceError } from '../device-error';
import type { ScaleProvider } from '../scale-provider';
import { CallLog } from './call-log';
import { NextFailure } from './next-failure';

/** A scale that returns the weights a test placed on it, one per reading. */
export class ScriptedScale implements ScaleProvider {
  readonly #weightsMilli: number[] = [];
  readonly #log: CallLog;
  readonly #nextFailure = new NextFailure();

  /** @param log where the call is recorded, shared with other fakes to check the order of a sale */
  constructor(log: CallLog = new CallLog()) {
    this.#log = log;
  }

  /**
   * Queues what the next readings return, in order.
   *
   * @param weightsMilli weights in thousandths of a kilogram
   * @throws RangeError if a weight is negative or not a safe integer, because a real scale never returns one
   */
  placeOnScale(...weightsMilli: number[]): void {
    for (const weightMilli of weightsMilli) {
      if (!Number.isSafeInteger(weightMilli) || weightMilli < 0) {
        throw new RangeError(`A weight must be a non-negative integer of thousandths, got ${weightMilli}`);
      }
    }
    this.#weightsMilli.push(...weightsMilli);
  }

  /**
   * Returns the next queued weight.
   *
   * @returns the weight in thousandths of a kilogram
   * @throws DeviceError if nothing was placed on the scale
   */
  async readWeightMilli(): Promise<number> {
    this.#log.record('scale.readWeightMilli');
    this.#nextFailure.throwIfArmed();
    const weightMilli = this.#weightsMilli.shift();
    if (weightMilli === undefined) {
      throw new DeviceError('scale', 'Nothing was placed on the scale');
    }
    return weightMilli;
  }

  /**
   * Makes the next reading fail, as a disconnected scale would.
   *
   * @param error what that reading throws
   */
  failNextWith(error: Error = new DeviceError('scale', 'The scale did not answer')): void {
    this.#nextFailure.arm(error);
  }
}
