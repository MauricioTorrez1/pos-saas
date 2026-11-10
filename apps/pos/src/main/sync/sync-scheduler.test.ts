import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_BACKOFF } from './backoff';
import type { PushOutcome } from './outbox-synchronizer';
import { SyncScheduler } from './sync-scheduler';

const WORKED: PushOutcome = { accepted: 1, duplicates: 0, quarantined: 0, remaining: 0, failure: null };
const FAILED: PushOutcome = { accepted: 0, duplicates: 0, quarantined: 0, remaining: 3, failure: new Error('No network') };

let outcomes: PushOutcome[];
let pushes: number;
let pushTimes: number[];
let scheduler: SyncScheduler;

/** Makes each push answer with the next outcome of the list, and repeat the last one when it runs out. */
function schedulerWith(list: PushOutcome[]): SyncScheduler {
  outcomes = list;
  pushes = 0;
  pushTimes = [];
  return new SyncScheduler({
    synchronizer: {
      pushPending: () => {
        const outcome = outcomes[Math.min(pushes, outcomes.length - 1)]!;
        pushes += 1;
        pushTimes.push(Date.now());
        return Promise.resolve(outcome);
      },
    },
    random: () => 0,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  scheduler.stop();
  vi.useRealTimers();
});

describe('the push loop', () => {
  it('pushes right away, and then every 5 seconds while everything works', async () => {
    scheduler = schedulerWith([WORKED]);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(pushes).toBe(1);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(pushes).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(pushes).toBe(2);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pushes).toBe(4);
  });

  it('waits longer after each failure, with exponential backoff up to the ceiling', async () => {
    scheduler = schedulerWith([FAILED]);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(400_000);

    // With no jitter the wait is half of the exponential value, and the ceiling is a minute: 2.5 s, 5 s, 10 s, 20 s, 30 s.
    const gaps = pushTimes.slice(1, 8).map((time, index) => time - pushTimes[index]!);
    expect(gaps.slice(0, 6)).toEqual([2_500, 5_000, 10_000, 20_000, 30_000, 30_000]);
    expect(DEFAULT_BACKOFF.maxMs).toBe(60_000);
  });

  it('goes back to the normal pace as soon as a push works', async () => {
    scheduler = schedulerWith([FAILED, FAILED, WORKED]);

    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_500);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pushes).toBe(3);

    await vi.advanceTimersByTimeAsync(5_000);
    expect(pushes).toBe(4);
  });

  it('pushes at once on a nudge and forgets the failures, as when the connection comes back', async () => {
    scheduler = schedulerWith([FAILED, FAILED, FAILED, WORKED]);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(2_500);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pushes).toBe(3);

    scheduler.nudge();
    await vi.advanceTimersByTimeAsync(0);

    expect(pushes).toBe(4);
  });

  it('stops pushing after stop, and starting twice does not double the loop', async () => {
    scheduler = schedulerWith([WORKED]);
    scheduler.start();
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(pushes).toBe(1);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(pushes).toBe(1);
  });

  it('reports every run, so the register can show a status', async () => {
    const seen: PushOutcome[] = [];
    scheduler = new SyncScheduler({ synchronizer: { pushPending: () => Promise.resolve(WORKED) }, onRun: (outcome) => seen.push(outcome) });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(seen).toEqual([WORKED, WORKED]);
  });
});
