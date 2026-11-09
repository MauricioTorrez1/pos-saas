import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalStore } from '../local-store/local-store';
import { AuthService, LOCK_MINUTES, MAX_FAILED_ATTEMPTS } from './auth-service';
import { UserStore } from './user-store';

const TENANT = 'tenant-a';
const START = new Date('2026-11-08T20:00:00.000Z');

let directory: string;
let databasePath: string;
let store: LocalStore;
let now: Date;
let auth: AuthService;

function openStore(): void {
  store = LocalStore.open({ path: databasePath, appVersion: '1.0.0' });
  auth = new AuthService(new UserStore(store, TENANT), () => now);
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'auth-'));
  databasePath = join(directory, 'pos.db');
  now = START;
  openStore();
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function afterMinutes(minutes: number): Date {
  return new Date(START.getTime() + minutes * 60_000);
}

function wrongPins(userId: string, times: number): void {
  for (let attempt = 0; attempt < times; attempt += 1) {
    auth.login(userId, '0000');
  }
}

describe('the first start', () => {
  it('needs an owner before anyone can sign in', () => {
    expect(auth.needsSetup()).toBe(true);
    expect(auth.listUsers()).toEqual([]);
  });

  it('creates the owner with a PIN, and then does not need setup', () => {
    const owner = auth.setupOwner('Mauricio', '4321');

    expect(owner).toMatchObject({ name: 'Mauricio', role: 'owner' });
    expect(auth.needsSetup()).toBe(false);
  });

  it('refuses to set up a second owner, so nobody can take over a register that already has one', () => {
    auth.setupOwner('Mauricio', '4321');

    expect(() => auth.setupOwner('Otro', '1111')).toThrow(/already/);
  });

  it('refuses a name that is empty or too long, and a PIN that is not four to eight digits', () => {
    expect(() => auth.setupOwner('   ', '4321')).toThrow(RangeError);
    expect(() => auth.setupOwner('x'.repeat(41), '4321')).toThrow(RangeError);
    expect(() => auth.setupOwner('Mauricio', '12')).toThrow(RangeError);
    expect(auth.needsSetup()).toBe(true);
  });

  it('never keeps the PIN: the database only has its hash', () => {
    auth.setupOwner('Mauricio', '4321');

    const row = store.prepare('SELECT pin_hash FROM app_user').get() as { pin_hash: string };

    expect(row.pin_hash).not.toContain('4321');
    expect(row.pin_hash).toMatch(/^scrypt\$/);
  });
});

describe('signing in', () => {
  it('lets a person in with their PIN, and knows who is signed in', () => {
    const owner = auth.setupOwner('Mauricio', '4321');

    expect(auth.login(owner.id, '4321')).toEqual({ status: 'ok', user: owner });
    expect(auth.currentUser()).toEqual(owner);
  });

  it('refuses a wrong PIN and says how many tries are left', () => {
    const owner = auth.setupOwner('Mauricio', '4321');

    expect(auth.login(owner.id, '1111')).toEqual({ status: 'wrong_pin', attemptsLeft: MAX_FAILED_ATTEMPTS - 1 });
    expect(auth.currentUser()).toBeNull();
  });

  it('does not know a user that does not exist', () => {
    expect(auth.login('019a5f2e-7c40-7b1a-9d2e-3f4a5b6c7d8e', '4321')).toEqual({ status: 'unknown_user' });
  });

  it('signs out', () => {
    const owner = auth.setupOwner('Mauricio', '4321');
    auth.login(owner.id, '4321');

    auth.logout();

    expect(auth.currentUser()).toBeNull();
  });

  it('works without internet, because nothing here talks to a server', () => {
    const owner = auth.setupOwner('Mauricio', '4321');
    store.close();
    openStore();

    expect(auth.login(owner.id, '4321').status).toBe('ok');
  });
});

describe('locking after wrong PINs (RF-009)', () => {
  it('locks after five wrong PINs, and refuses even the right one while locked', () => {
    const owner = auth.setupOwner('Mauricio', '4321');

    wrongPins(owner.id, MAX_FAILED_ATTEMPTS);

    expect(auth.login(owner.id, '4321')).toEqual({ status: 'locked', until: afterMinutes(LOCK_MINUTES).toISOString() });
    expect(auth.currentUser()).toBeNull();
  });

  it('lets the person in again once the lock is over, and starts counting from zero', () => {
    const owner = auth.setupOwner('Mauricio', '4321');
    wrongPins(owner.id, MAX_FAILED_ATTEMPTS);

    now = afterMinutes(LOCK_MINUTES + 1);

    expect(auth.login(owner.id, '0000')).toEqual({ status: 'wrong_pin', attemptsLeft: MAX_FAILED_ATTEMPTS - 1 });
    expect(auth.login(owner.id, '4321').status).toBe('ok');
  });

  it('forgets the wrong PINs after a right one', () => {
    const owner = auth.setupOwner('Mauricio', '4321');
    wrongPins(owner.id, MAX_FAILED_ATTEMPTS - 1);

    auth.login(owner.id, '4321');

    expect(auth.login(owner.id, '0000')).toEqual({ status: 'wrong_pin', attemptsLeft: MAX_FAILED_ATTEMPTS - 1 });
  });

  it('keeps the lock after the register restarts, so closing it does not reset the count', () => {
    const owner = auth.setupOwner('Mauricio', '4321');
    wrongPins(owner.id, MAX_FAILED_ATTEMPTS);

    store.close();
    openStore();

    expect(auth.login(owner.id, '4321').status).toBe('locked');
  });

  it('locks each person on their own', () => {
    const owner = auth.setupOwner('Mauricio', '4321');
    auth.login(owner.id, '4321');
    const cashier = auth.createUser('Ana', 'cashier', '5555');
    auth.logout();

    wrongPins(cashier.id, MAX_FAILED_ATTEMPTS);

    expect(auth.login(cashier.id, '5555').status).toBe('locked');
    expect(auth.login(owner.id, '4321').status).toBe('ok');
  });
});

describe('people', () => {
  it('lets the owner add a cashier, who then signs in with their own PIN', () => {
    const owner = auth.setupOwner('Mauricio', '4321');
    auth.login(owner.id, '4321');

    const cashier = auth.createUser('Ana', 'cashier', '5555');

    expect(auth.listUsers().map(({ name }) => name)).toEqual(['Ana', 'Mauricio']);
    auth.logout();
    expect(auth.login(cashier.id, '5555')).toEqual({ status: 'ok', user: cashier });
  });

  it('does not let a cashier, or nobody, add people', () => {
    const owner = auth.setupOwner('Mauricio', '4321');
    auth.login(owner.id, '4321');
    const cashier = auth.createUser('Ana', 'cashier', '5555');
    auth.logout();

    expect(() => auth.createUser('Intruso', 'cashier', '1234')).toThrow(/owner/);
    auth.login(cashier.id, '5555');
    expect(() => auth.createUser('Intruso', 'cashier', '1234')).toThrow(/owner/);
  });

  it('refuses two people with the same name', () => {
    const owner = auth.setupOwner('Mauricio', '4321');
    auth.login(owner.id, '4321');

    expect(() => auth.createUser('Mauricio', 'cashier', '5555')).toThrow(/UNIQUE|already/);
  });
});

describe('authorizing with the PIN of the owner', () => {
  it('names the owner whose PIN it is, without signing anyone in', () => {
    const owner = auth.setupOwner('Mauricio', '4321');
    auth.login(owner.id, '4321');
    const cashier = auth.createUser('Ana', 'cashier', '5555');
    auth.logout();
    auth.login(cashier.id, '5555');

    expect(auth.authorizeWithOwnerPin('4321')).toEqual({ status: 'ok', owner });
    expect(auth.currentUser()).toEqual(cashier);
  });

  it('refuses the PIN of a cashier, and a wrong one', () => {
    const owner = auth.setupOwner('Mauricio', '4321');
    auth.login(owner.id, '4321');
    auth.createUser('Ana', 'cashier', '5555');

    expect(auth.authorizeWithOwnerPin('5555').status).toBe('wrong_pin');
    expect(auth.authorizeWithOwnerPin('0000').status).toBe('wrong_pin');
  });

  it('counts the wrong PINs against the owner, so the PIN cannot be guessed from the authorization box', () => {
    auth.setupOwner('Mauricio', '4321');

    for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt += 1) {
      auth.authorizeWithOwnerPin('0000');
    }

    expect(auth.authorizeWithOwnerPin('4321').status).toBe('locked');
  });
});
