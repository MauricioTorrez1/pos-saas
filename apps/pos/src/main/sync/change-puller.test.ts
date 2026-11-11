import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalStore } from '../local-store/local-store';
import { ProductCatalog } from '../local-store/product-catalog';
import { ChangeApplier } from './change-applier';
import { ChangePuller } from './change-puller';
import { FakePullTransport } from './fakes/fake-pull-transport';
import type { ProductState } from './pull-protocol';
import { SyncOutbox } from './sync-outbox';

const TENANT = 'tenant-a';

function product(name: string, unitPriceE4 = 100_000): ProductState {
  return { name, baseUnit: 'piece', unitPriceE4, taxFactor: 'rate', taxRateBp: 1600, barcodes: [] };
}

let directory: string;
let store: LocalStore;
let applier: ChangeApplier;
let catalog: ProductCatalog;
let core: FakePullTransport;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'change-puller-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  applier = new ChangeApplier(store, TENANT);
  catalog = new ProductCatalog(store, TENANT);
  core = new FakePullTransport();
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function puller(pageSize?: number): ChangePuller {
  return new ChangePuller({ applier, transport: core, ...(pageSize === undefined ? {} : { pageSize }) });
}

function publish(count: number): void {
  for (let number = 1; number <= count; number += 1) {
    core.publishProduct(number, product(`Product ${number}`));
  }
}

describe('catching up', () => {
  it('downloads page after page until it has everything, and keeps the cursor of the last one', async () => {
    publish(5);

    const outcome = await puller(2).pullAll();

    expect(outcome).toEqual({ pages: 3, changes: 5, cursor: '5', failure: null });
    expect(core.requests).toEqual([
      ['0', 2],
      ['2', 2],
      ['4', 2],
    ]);
    expect(catalog.findById(FakePullTransport.productId(5))?.name).toBe('Product 5');
  });

  it('asks again from its cursor and gets only what is new', async () => {
    publish(3);
    await puller().pullAll();

    core.publishProduct(2, product('Product 2', 555_555));
    const outcome = await puller().pullAll();

    expect(outcome).toMatchObject({ pages: 1, changes: 1, cursor: '4', failure: null });
    expect(core.requests.at(-1)).toEqual(['3', 200]);
    expect(catalog.findById(FakePullTransport.productId(2))?.unitPriceE4).toBe(555_555);
  });

  it('removes a product the core deleted', async () => {
    publish(2);
    await puller().pullAll();

    core.deleteProduct(1);
    await puller().pullAll();

    expect(catalog.findById(FakePullTransport.productId(1))).toBeNull();
    expect(catalog.findById(FakePullTransport.productId(2))).not.toBeNull();
  });

  it('does nothing when nothing changed, and does not move the cursor', async () => {
    const outcome = await puller().pullAll();

    expect(outcome).toEqual({ pages: 1, changes: 0, cursor: '0', failure: null });
  });

  it('joins a run that is already going, so one page is never applied twice at once', async () => {
    publish(3);
    const shared = puller();

    const first = shared.pullAll();
    const second = shared.pullAll();
    await first;

    expect(first).toBe(second);
    expect(core.requests).toHaveLength(1);
  });
});

describe('when the network fails', () => {
  it('keeps the cursor when the network drops before an answer, and catches up once it is back', async () => {
    publish(5);
    core.cutNext('before-the-core-answers');

    const failed = await puller(2).pullAll();

    expect(failed).toMatchObject({ pages: 0, cursor: '0' });
    expect(failed.failure).toBeInstanceOf(Error);
    expect(catalog.findById(FakePullTransport.productId(1))).toBeNull();

    const recovered = await puller(2).pullAll();
    expect(recovered).toMatchObject({ pages: 3, changes: 5, cursor: '5', failure: null });
  });

  it('keeps the first page and resumes from the second after a cut in the middle of it', async () => {
    publish(6);
    applier.apply(await core.pull('0', 2));
    core.cutNext('in-the-middle-of-the-answer');

    const cut = await puller(2).pullAll();

    expect(cut.failure?.message).toContain('cut off');
    expect(cut.pages).toBe(0);
    expect(applier.currentCursor()).toBe('2');
    expect(catalog.findById(FakePullTransport.productId(2))).not.toBeNull();
    expect(catalog.findById(FakePullTransport.productId(3))).toBeNull();

    const resumed = await puller(2).pullAll();
    expect(resumed).toMatchObject({ pages: 2, changes: 4, cursor: '6', failure: null });
    expect(core.requests.at(-1)).toEqual(['4', 2]);
  });

  it('reports a core that answers with an error and tries again later with the same cursor', async () => {
    publish(2);
    core.failWith(503);

    const down = await puller().pullAll();
    core.recover();
    const up = await puller().pullAll();

    expect(down.failure?.message).toContain('503');
    expect(down.cursor).toBe('0');
    expect(up).toMatchObject({ changes: 2, cursor: '2', failure: null });
  });

  it('stops at a kind of entity it does not know and does not move past it, so nothing is lost', async () => {
    core.publishProduct(1, product('Product 1'));
    core.publishUnknown('loyalty_card');
    core.publishProduct(2, product('Product 2'));

    const outcome = await puller(1).pullAll();

    expect(outcome.failure?.message).toContain('contract');
    expect(outcome.cursor).toBe('1');
    expect(catalog.findById(FakePullTransport.productId(2))).toBeNull();
  });

  it('starts over when the core says the cursor is ahead of it, as after a restore from a backup', async () => {
    publish(3);
    await puller().pullAll();
    store.transaction((connection) => connection.exec("UPDATE sync_pull_state SET cursor = '9'"));

    const reset = await puller().pullAll();
    const again = await puller().pullAll();

    expect(reset.failure?.message).toContain('reset');
    expect(again).toMatchObject({ changes: 3, cursor: '3', failure: null });
  });
});

describe('without getting in the way of the register', () => {
  it('leaves the sync outbox untouched, so selling and sending do not depend on it', async () => {
    const outbox = new SyncOutbox(store, TENANT);
    const opId = store.transaction(() => outbox.enqueue('cash_movement.recorded', { number: 1 }));
    publish(3);

    await puller().pullAll();

    expect(outbox.pending(10).map((operation) => operation.opId)).toEqual([opId]);
  });

  it('is refused a page size the core does not allow', () => {
    expect(() => puller(501)).toThrow(RangeError);
    expect(() => puller(0)).toThrow(RangeError);
  });
});
