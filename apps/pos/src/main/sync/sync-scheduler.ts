import { backoffDelayMs, DEFAULT_BACKOFF, type BackoffPolicy } from './backoff';
import type { PushOutcome } from './outbox-synchronizer';

/** How often the outbox is looked at while everything works. */
export const DEFAULT_PUSH_INTERVAL_MS = 5_000;

/** How often the register asks the core for changes while everything works. A price change is not urgent to the second. */
export const DEFAULT_PULL_INTERVAL_MS = 30_000;

/** What `SyncScheduler` needs. */
export interface SyncSchedulerOptions<Outcome extends { readonly failure: Error | null } = PushOutcome> {
  /**
   * What to run each time. It is the outbox synchronizer for the push; the pull passes `{ pushPending: () => puller.pullAll() }`,
   * because the loop only needs something that runs and says whether it failed.
   */
  readonly synchronizer: { readonly pushPending: () => Promise<Outcome> };
  /** Time between pushes while they work. */
  readonly intervalMs?: number;
  readonly backoff?: BackoffPolicy;
  /** Called after every run, for logs or a status light. */
  readonly onRun?: (outcome: Outcome) => void;
  /** Replaces `Math.random` for the jitter. Only tests pass it. */
  readonly random?: () => number;
}

/**
 * Runs the synchronizer every few seconds, and after each failure waits longer before trying again. It lives apart from
 * the sales: a sale only writes to the local database, so a dead network slows this loop and nothing else.
 */
export class SyncScheduler<Outcome extends { readonly failure: Error | null } = PushOutcome> {
  readonly #synchronizer: { readonly pushPending: () => Promise<Outcome> };
  readonly #intervalMs: number;
  readonly #backoff: BackoffPolicy;
  readonly #onRun: ((outcome: Outcome) => void) | undefined;
  readonly #random: () => number;
  #timer: ReturnType<typeof setTimeout> | null = null;
  #consecutiveFailures = 0;
  #started = false;

  /** @param options the synchronizer to run and how often */
  constructor({ synchronizer, intervalMs = DEFAULT_PUSH_INTERVAL_MS, backoff = DEFAULT_BACKOFF, onRun, random = Math.random }: SyncSchedulerOptions<Outcome>) {
    this.#synchronizer = synchronizer;
    this.#intervalMs = intervalMs;
    this.#backoff = backoff;
    this.#onRun = onRun;
    this.#random = random;
  }

  /** Starts the loop with a first push right away. Calling it twice does nothing. */
  start(): void {
    if (this.#started) {
      return;
    }
    this.#started = true;
    this.#schedule(0);
  }

  /** Stops the loop. A push already on the wire finishes, but no other starts. */
  stop(): void {
    this.#started = false;
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
  }

  /** Pushes now and forgets the failures, for when the connection comes back and waiting longer makes no sense. */
  nudge(): void {
    if (this.#started) {
      this.#consecutiveFailures = 0;
      this.#schedule(0);
    }
  }

  #schedule(delayMs: number): void {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
    }
    this.#timer = setTimeout(() => void this.#tick(), delayMs);
    // The loop alone must not keep the app alive when the window closes.
    this.#timer.unref();
  }

  async #tick(): Promise<void> {
    this.#timer = null;
    const outcome = await this.#synchronizer.pushPending();
    this.#consecutiveFailures = outcome.failure === null ? 0 : this.#consecutiveFailures + 1;
    this.#onRun?.(outcome);
    if (this.#started) {
      // A timer that was set while this push ran (`nudge`) is already pending, and it wins.
      if (this.#timer === null) {
        this.#schedule(this.#consecutiveFailures === 0 ? this.#intervalMs : backoffDelayMs(this.#consecutiveFailures, this.#backoff, this.#random()));
      }
    }
  }
}
