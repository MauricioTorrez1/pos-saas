/** How long to wait between failed pushes. */
export interface BackoffPolicy {
  /** Wait after the first failure, in milliseconds. It doubles with each further one. */
  readonly baseMs: number;
  /** The wait never grows past this, so a register that was offline for hours still reconnects within a minute. */
  readonly maxMs: number;
}

/** 5 seconds after the first failure, doubling up to one minute. */
export const DEFAULT_BACKOFF: BackoffPolicy = { baseMs: 5_000, maxMs: 60_000 };

/**
 * Works out how long to wait after a run of failures, with exponential backoff (each wait doubles) and jitter (a random
 * part, so many registers that lost the connection together do not all come back at the same instant).
 *
 * @param consecutiveFailures how many pushes in a row failed, at least 1
 * @param policy the base and the ceiling
 * @param random a number in [0, 1). Only tests pass it.
 * @returns the wait in milliseconds, between half of the exponential value and all of it
 * @throws RangeError if `consecutiveFailures` is below 1
 */
export function backoffDelayMs(consecutiveFailures: number, policy: BackoffPolicy = DEFAULT_BACKOFF, random: number = Math.random()): number {
  if (!Number.isInteger(consecutiveFailures) || consecutiveFailures < 1) {
    throw new RangeError('The number of consecutive failures must be a whole number of at least 1');
  }
  const exponent = Math.min(consecutiveFailures - 1, 30);
  const ceiling = Math.min(policy.maxMs, policy.baseMs * 2 ** exponent);
  return Math.floor(ceiling / 2 + random * (ceiling / 2));
}
