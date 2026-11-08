import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_APPEARANCE, type Appearance } from '../../shared/appearance';
import { AppearanceStore } from './appearance-store';
import { LocalStore } from './local-store';

const TENANT = 'tenant-a';
const CUSTOM: Appearance = { businessName: 'Tlapalería Torres', accent: 'blue', textSize: 'large', theme: 'dark' };

let directory: string;
let store: LocalStore;
let appearance: AppearanceStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'appearance-store-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  appearance = new AppearanceStore(store, TENANT);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('AppearanceStore', () => {
  it('starts with the default appearance', () => {
    expect(appearance.read()).toEqual(DEFAULT_APPEARANCE);
  });

  it('reads back what was saved', () => {
    appearance.save(CUSTOM);

    expect(appearance.read()).toEqual(CUSTOM);
  });

  it('keeps only the latest appearance', () => {
    appearance.save(CUSTOM);
    appearance.save({ ...CUSTOM, accent: 'red' });

    expect(appearance.read().accent).toBe('red');
    expect(store.prepare('SELECT count(*) AS rows FROM register_appearance').get()).toEqual({ rows: 1 });
  });

  it('does not mix the appearance of two businesses', () => {
    appearance.save(CUSTOM);

    expect(new AppearanceStore(store, 'tenant-b').read()).toEqual(DEFAULT_APPEARANCE);
  });

  it('falls back to the default instead of failing on a value this version does not offer', () => {
    appearance.save(CUSTOM);
    store.transaction((connection) => {
      connection.exec("UPDATE register_appearance SET accent = 'pink'");
    });

    expect(appearance.read()).toEqual(DEFAULT_APPEARANCE);
  });
});
