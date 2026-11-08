/** What SQLite reports when it cannot reset the shared-memory file (`-shm`) left by a dead process. */
const SQLITE_IOERR_TRUNCATE = 1546;

/** How long to keep trying to open. */
export interface RetryTiming {
  readonly limitMs: number;
  readonly delayMs: number;
}

/** Windows was seen holding the file for up to 4.9 seconds, and the cashier has no window to look at yet. */
const DEFAULT_TIMING: RetryTiming = { limitMs: 15_000, delayMs: 100 };

function isSharedMemoryBusy(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'errcode' in error && error.errcode === SQLITE_IOERR_TRUNCATE;
}

/** Opening is synchronous and no window exists yet, so blocking the thread freezes nothing. */
function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * Runs `open`, and runs it again while the shared-memory file is not free yet.
 *
 * After a forced close, Windows keeps that file busy for a few seconds. The file is only an index that
 * SQLite rebuilds from the WAL, and the sales are in the WAL, so waiting is safe.
 *
 * @param open opens the database, and must leave nothing open when it throws
 * @param timing how long to keep trying, which only tests change
 * @returns what `open` returns
 * @throws any other error at once, and this one if it continues past the time limit
 */
export function retryWhileSharedMemoryBusy<T>(open: () => T, timing: RetryTiming = DEFAULT_TIMING): T {
  const deadline = Date.now() + timing.limitMs;
  for (;;) {
    try {
      return open();
    } catch (error) {
      if (!isSharedMemoryBusy(error) || Date.now() >= deadline) {
        throw error;
      }
      sleepSync(timing.delayMs);
    }
  }
}
