import { describe, expect, it } from 'vitest';

import { retryWhileSharedMemoryBusy } from './shared-memory-retry';

const FAST_TIMING = { limitMs: 50, delayMs: 1 };
const SHARED_MEMORY_BUSY = Object.assign(new Error('disk I/O error'), { errcode: 1546 });

describe('retryWhileSharedMemoryBusy', () => {
  it('returns the result at once when opening works', () => {
    let attempts = 0;

    const result = retryWhileSharedMemoryBusy(() => {
      attempts += 1;
      return 'open';
    }, FAST_TIMING);

    expect(result).toBe('open');
    expect(attempts).toBe(1);
  });

  it('tries again while the shared memory is busy', () => {
    let attempts = 0;

    const result = retryWhileSharedMemoryBusy(() => {
      attempts += 1;
      if (attempts < 3) {
        throw SHARED_MEMORY_BUSY;
      }
      return 'open';
    }, FAST_TIMING);

    expect(result).toBe('open');
    expect(attempts).toBe(3);
  });

  it.each([
    ['another SQLite error', Object.assign(new Error('database disk image is malformed'), { errcode: 11 })],
    ['an error without a code', new Error('something else')],
    ['a value that is not an error', 'failure'],
  ])('does not try again after %s, because waiting would hide it', (_description, failure) => {
    let attempts = 0;

    expect(() =>
      retryWhileSharedMemoryBusy(() => {
        attempts += 1;
        throw failure;
      }, FAST_TIMING),
    ).toThrow();
    expect(attempts).toBe(1);
  });

  it('gives up with the original error when the time limit passes', () => {
    let attempts = 0;

    expect(() =>
      retryWhileSharedMemoryBusy(() => {
        attempts += 1;
        throw SHARED_MEMORY_BUSY;
      }, FAST_TIMING),
    ).toThrow(SHARED_MEMORY_BUSY);
    expect(attempts).toBeGreaterThan(1);
  });
});
