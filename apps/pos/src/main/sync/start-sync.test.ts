import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalStore } from '../local-store/local-store';
import { startSyncIfConfigured } from './start-sync';

let directory: string;
let store: LocalStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'start-sync-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('starting the sync', () => {
  it.each([undefined, '', '   '])('stays offline without an address (%j), and the register sells all the same', (address) => {
    expect(startSyncIfConfigured(store, 'tenant-a', address)).toBeNull();
  });

  it('starts a loop that can be stopped when an address is given', () => {
    const scheduler = startSyncIfConfigured(store, 'tenant-a', 'http://127.0.0.1:9');

    expect(scheduler).not.toBeNull();
    scheduler?.stop();
  });
});
