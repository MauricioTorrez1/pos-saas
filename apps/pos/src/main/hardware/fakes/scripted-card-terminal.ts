import type { CardChargeRequest, CardChargeResult, CardTerminal } from '../card-terminal';
import { DeviceError } from '../device-error';
import { CallLog } from './call-log';
import { NextFailure } from './next-failure';

/** A card terminal that answers what a test scripted, and keeps the promise of never charging twice. */
export class ScriptedCardTerminal implements CardTerminal {
  readonly #outcomes: CardChargeResult[] = [];
  readonly #outcomesByKey = new Map<string, CardChargeResult>();
  readonly #charges: CardChargeRequest[] = [];
  readonly #log: CallLog;
  readonly #nextFailure = new NextFailure();

  /** @param log where the call is recorded, shared with other fakes to check the order of a sale */
  constructor(log: CallLog = new CallLog()) {
    this.#log = log;
  }

  /**
   * Queues the outcomes of the next new charges, in order. Without one, a charge is approved.
   *
   * @param outcomes what the next charges return
   */
  willRespond(...outcomes: CardChargeResult[]): void {
    this.#outcomes.push(...outcomes);
  }

  /**
   * Charges once per idempotency key. A retry with a known key returns the first outcome and charges nothing.
   *
   * @param request the sale, the attempt key, and the amount
   * @returns the scripted outcome, or an approval with a sequential authorization code
   * @throws RangeError if the amount is not a positive integer of cents
   */
  async charge(request: CardChargeRequest): Promise<CardChargeResult> {
    this.#log.record('cardTerminal.charge');
    this.#nextFailure.throwIfArmed();
    if (!Number.isSafeInteger(request.amountCents) || request.amountCents <= 0) {
      throw new RangeError(`A charge must be a positive integer of cents, got ${request.amountCents}`);
    }
    const earlierOutcome = this.#outcomesByKey.get(request.idempotencyKey);
    if (earlierOutcome) {
      return earlierOutcome;
    }
    this.#charges.push({ ...request });
    const outcome = this.#outcomes.shift() ?? approvedWithCode(this.#charges.length);
    this.#outcomesByKey.set(request.idempotencyKey, outcome);
    return outcome;
  }

  /** Charges that reached a card, in order. A retry with a known key is not one. */
  get charges(): readonly CardChargeRequest[] {
    return this.#charges.map((charge) => ({ ...charge }));
  }

  /**
   * Makes the next charge fail before it reaches the card, as a terminal without signal would.
   *
   * @param error what that charge throws
   */
  failNextWith(error: Error = new DeviceError('cardTerminal', 'The card terminal did not answer')): void {
    this.#nextFailure.arm(error);
  }
}

function approvedWithCode(chargeNumber: number): CardChargeResult {
  return { status: 'approved', authorizationCode: String(chargeNumber).padStart(6, '0') };
}
