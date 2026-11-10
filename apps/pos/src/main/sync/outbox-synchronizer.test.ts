import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalStore } from '../local-store/local-store';
import { FakeSyncTransport } from './fakes/fake-sync-transport';
import { OutboxSynchronizer } from './outbox-synchronizer';
import { SyncOutbox } from './sync-outbox';
import { SyncProtocolError, type SyncPushRequest, type SyncPushResponse } from './sync-protocol';
import type { SyncTransport } from './sync-transport';

const TENANT = 'tenant-a';
const REGISTER_ID = '0193a5c0-0000-7000-8000-000000000001';

let directory: string;
let store: LocalStore;
let outbox: SyncOutbox;
let core: FakeSyncTransport;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'synchronizer-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  outbox = new SyncOutbox(store, TENANT);
  core = new FakeSyncTransport();
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

/** Queues `count` operations, one transaction each, like `count` sales rung up one after another. */
function queue(count: number): string[] {
  return Array.from({ length: count }, (_, index) =>
    store.transaction(() => outbox.enqueue('cash_movement.recorded', { number: index + 1 })),
  );
}

function synchronizer(transport: SyncTransport = core, batchSize?: number): OutboxSynchronizer {
  return new OutboxSynchronizer({ outbox, transport, registerId: REGISTER_ID, ...(batchSize === undefined ? {} : { batchSize }) });
}

function stateOf(opId: string): { status: string; server_status: string | null; attempts: number } {
  return store.prepare('SELECT status, server_status, attempts FROM sync_outbox WHERE op_id = ?').get(opId) as never;
}

describe('sending in order', () => {
  it('sends everything pending in ascending device_seq, split in batches of the size asked for', async () => {
    const ids = queue(7);

    const outcome = await synchronizer(core, 3).pushPending();

    expect(outcome).toMatchObject({ accepted: 7, duplicates: 0, quarantined: 0, remaining: 0, failure: null });
    expect(core.requests.map((request) => request.operations.length)).toEqual([3, 3, 1]);
    expect(core.stored.map((operation) => operation.opId)).toEqual(ids);
    const seqs = core.stored.map((operation) => operation.deviceSeq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(7);
  });

  it('identifies the register and never sends more than the contract allows in one batch', async () => {
    queue(250);

    await synchronizer().pushPending();

    expect(core.requests.every((request) => request.registerId === REGISTER_ID)).toBe(true);
    expect(core.requests.map((request) => request.operations.length)).toEqual([100, 100, 50]);
  });

  it('refuses a batch size above what the core accepts', () => {
    expect(() => synchronizer(core, 101)).toThrow(RangeError);
    expect(() => synchronizer(core, 0)).toThrow(RangeError);
  });

  it('keeps the order by sequence even when the clock goes backwards', async () => {
    const [first, second] = [
      store.transaction(() => outbox.enqueue('cash_movement.recorded', { number: 1 }, '2026-12-10T12:00:00.000Z')),
      store.transaction(() => outbox.enqueue('cash_movement.recorded', { number: 2 }, '2026-12-10T11:00:00.000Z')),
    ];

    await synchronizer().pushPending();

    expect(core.stored.map((operation) => operation.opId)).toEqual([first, second]);
  });

  it('does nothing when there is nothing to send', async () => {
    const outcome = await synchronizer().pushPending();

    expect(outcome).toEqual({ accepted: 0, duplicates: 0, quarantined: 0, remaining: 0, failure: null });
    expect(core.requests).toHaveLength(0);
  });

  it('never sends the same operations in two pushes at once', async () => {
    queue(3);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: SyncTransport = {
      push: async (request) => {
        await gate;
        return core.push(request);
      },
    };
    const sender = synchronizer(slow);

    const first = sender.pushPending();
    const second = sender.pushPending();
    release();
    await Promise.all([first, second]);

    expect(core.requests).toHaveLength(1);
  });
});

describe('a network cut halfway through a delivery', () => {
  it('keeps everything pending when the connection drops before the core receives the batch', async () => {
    const ids = queue(3);
    core.cutNext('before-the-core-receives');

    const outcome = await synchronizer().pushPending();

    expect(outcome.failure).toMatchObject({ name: 'SyncTransportError' });
    expect(outcome.remaining).toBe(3);
    expect(core.stored).toHaveLength(0);
    expect(ids.map((id) => stateOf(id))).toEqual([
      { status: 'pending', server_status: null, attempts: 1 },
      { status: 'pending', server_status: null, attempts: 1 },
      { status: 'pending', server_status: null, attempts: 1 },
    ]);
  });

  it('sends again after the core stored a batch whose answer never arrived, without duplicating or losing anything', async () => {
    const ids = queue(3);
    core.cutNext('after-the-core-stores-before-answering');

    const cut = await synchronizer().pushPending();
    expect(cut.failure).not.toBeNull();
    // The core has the sales, but the register has no proof of it, so it keeps them pending.
    expect(core.stored).toHaveLength(3);
    expect(cut.remaining).toBe(3);

    const retry = await synchronizer().pushPending();

    expect(retry).toMatchObject({ accepted: 0, duplicates: 3, remaining: 0, failure: null });
    expect(core.stored.map((operation) => operation.opId)).toEqual(ids);
    expect(ids.map((id) => stateOf(id).server_status)).toEqual(['duplicate', 'duplicate', 'duplicate']);
  });

  it('survives the connection dropping in the middle of a long run of batches', async () => {
    const ids = queue(9);
    // The first batch of 3 goes through, and the answer of the second is lost.
    const flaky: SyncTransport = {
      push: async (request) => {
        const answer = await core.push(request);
        if (core.requests.length === 2) {
          throw new Error('Connection reset');
        }
        return answer;
      },
    };

    const first = await synchronizer(flaky, 3).pushPending();

    expect(first).toMatchObject({ accepted: 3, remaining: 6 });
    expect(first.failure?.message).toBe('Connection reset');
    expect(core.stored).toHaveLength(6);

    const second = await synchronizer(core, 3).pushPending();

    expect(second).toMatchObject({ accepted: 3, duplicates: 3, remaining: 0, failure: null });
    expect(core.stored.map((operation) => operation.opId)).toEqual(ids);
    expect(new Set(core.stored.map((operation) => operation.opId)).size).toBe(9);
  });

  it('resumes from the oldest unconfirmed operation after a restart of the register', async () => {
    const ids = queue(4);
    core.cutNext('before-the-core-receives');
    await synchronizer().pushPending();
    store.close();

    store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
    outbox = new SyncOutbox(store, TENANT);
    await synchronizer().pushPending();

    expect(core.stored.map((operation) => operation.opId)).toEqual(ids);
  });

  it('marks an operation as delivered only when the core confirmed that very operation', async () => {
    const ids = queue(3);
    core.stopAfterNext(2);
    // The core handles two of the three, and then the connection is lost before the register can ask again.
    const dropsAfterTheFirstBatch: SyncTransport = {
      push: (request) => (core.requests.length === 0 ? core.push(request) : Promise.reject(new Error('Connection reset'))),
    };

    const outcome = await synchronizer(dropsAfterTheFirstBatch, 3).pushPending();

    expect(ids.map((id) => stateOf(id))).toEqual([
      { status: 'delivered', server_status: 'accepted', attempts: 0 },
      { status: 'delivered', server_status: 'accepted', attempts: 0 },
      { status: 'pending', server_status: null, attempts: 2 },
    ]);
    expect(outcome).toMatchObject({ accepted: 2, remaining: 1 });

    await synchronizer(core, 3).pushPending();

    expect(core.requests.map((request) => request.operations.map((operation) => operation.opId))).toEqual([ids, [ids[2]]]);
    expect(core.stored.map((operation) => operation.opId)).toEqual(ids);
  });

  it('stops instead of looping when the core confirms nothing at all', async () => {
    const ids = queue(2);
    const silent: SyncTransport = { push: () => Promise.resolve({ results: [] }) };

    const outcome = await synchronizer(silent).pushPending();

    expect(outcome.failure).toBeInstanceOf(SyncProtocolError);
    expect(outcome.remaining).toBe(2);
    expect(ids.map((id) => stateOf(id))).toEqual([
      { status: 'pending', server_status: null, attempts: 1 },
      { status: 'pending', server_status: null, attempts: 1 },
    ]);
  });

  it('ignores a confirmation for an operation that was not in the batch', async () => {
    const [first, later] = queue(2);
    let calls = 0;
    const lying: SyncTransport = {
      push: (request: SyncPushRequest): Promise<SyncPushResponse> => {
        calls += 1;
        // The first answer also "confirms" an operation that was not sent. The next ones confirm nothing.
        return Promise.resolve({
          results: calls === 1 ? [{ opId: later!, status: 'accepted' }, { opId: request.operations[0]!.opId, status: 'accepted' }] : [],
        });
      },
    };

    await synchronizer(lying, 1).pushPending();

    expect(stateOf(first!).status).toBe('delivered');
    expect(stateOf(later!).status).toBe('pending');
  });

  it('keeps pending what the core answers with an error status, and recovers when it comes back', async () => {
    const ids = queue(2);
    core.failWith(503);

    const down = await synchronizer().pushPending();
    expect(down.failure).toMatchObject({ name: 'SyncTransportError', status: 503 });
    expect(down.remaining).toBe(2);

    core.recover();
    const up = await synchronizer().pushPending();

    expect(up).toMatchObject({ accepted: 2, remaining: 0, failure: null });
    expect(ids.map((id) => stateOf(id).status)).toEqual(['delivered', 'delivered']);
  });
});

describe('what the core says about each operation', () => {
  it('records a quarantined operation as delivered, never retries it, and does not block the ones after it', async () => {
    const [bad, good] = queue(2);
    core.quarantine(bad!);

    const outcome = await synchronizer().pushPending();

    expect(outcome).toMatchObject({ accepted: 1, quarantined: 1, remaining: 0, failure: null });
    expect(stateOf(bad!)).toEqual({ status: 'delivered', server_status: 'quarantined', attempts: 0 });
    expect(stateOf(good!).server_status).toBe('accepted');
    expect(outbox.counts()).toEqual({ pending: 0, delivered: 2, quarantined: 1 });
    await synchronizer().pushPending();
    expect(core.requests).toHaveLength(1);
  });

  it('does not send again what was confirmed', async () => {
    queue(2);
    await synchronizer().pushPending();

    await synchronizer().pushPending();

    expect(core.requests).toHaveLength(1);
  });

  it('keeps the error of the last failed attempt to show to whoever looks', async () => {
    const [id] = queue(1);
    core.failWith(500);

    await synchronizer().pushPending();

    expect(store.prepare('SELECT last_error, last_attempt_at FROM sync_outbox WHERE op_id = ?').get(id!)).toMatchObject({ last_error: 'The core answered 500' });
  });
});

describe('selling without a network (RF-020)', () => {
  it('queues operations while every push fails, and sends them all, in order, once the network is back', async () => {
    core.failWith(0);
    const ids: string[] = [];
    for (let sale = 1; sale <= 50; sale += 1) {
      ids.push(...queue(1));
      // The loop keeps trying all the time, and it never gets in the way of the sale that was just recorded.
      if (sale % 10 === 0) {
        expect((await synchronizer().pushPending()).failure).not.toBeNull();
      }
    }
    expect(outbox.counts().pending).toBe(50);

    core.recover();
    const outcome = await synchronizer().pushPending();

    expect(outcome).toMatchObject({ accepted: 50, remaining: 0, failure: null });
    expect(core.stored.map((operation) => operation.opId)).toEqual(ids);
  });
});
