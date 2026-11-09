import { MAX_USER_NAME_LENGTH, type LoginResult, type UserRole, type UserSummary } from '../../shared/auth';
import { hashPin, verifyPin } from './pin-hasher';
import type { UserCredentials, UserStore } from './user-store';

/** Wrong PINs in a row before the person is locked out. */
export const MAX_FAILED_ATTEMPTS = 5;

/** How long a lock lasts. Long enough to stop guessing, short enough not to stop a store from selling. */
export const LOCK_MINUTES = 5;

const MS_PER_MINUTE = 60_000;

/** How asking for the PIN of an owner ended. */
export type OwnerAuthorization =
  | { readonly status: 'ok'; readonly owner: UserSummary }
  | { readonly status: 'wrong_pin'; readonly attemptsLeft: number }
  | { readonly status: 'locked'; readonly until: string };

/**
 * Who is signed in at this register. People enter with a PIN checked against a hash kept in the local database, so it
 * works without internet (ADR 0006). The person who is signed in lives in memory only: closing the register signs them
 * out, and the next one starts with their own PIN.
 */
export class AuthService {
  readonly #users: UserStore;
  readonly #now: () => Date;
  #current: UserSummary | null = null;

  /**
   * @param users where the people and their hashes are kept
   * @param now the clock, so a test can move time
   */
  constructor(users: UserStore, now: () => Date = () => new Date()) {
    this.#users = users;
    this.#now = now;
  }

  /** @returns true when nobody has been registered yet, so the first person must become the owner */
  needsSetup(): boolean {
    return this.#users.count() === 0;
  }

  /** @returns the people who can sign in, by name */
  listUsers(): UserSummary[] {
    return this.#users.list();
  }

  /** @returns who is signed in, or null */
  currentUser(): UserSummary | null {
    return this.#current;
  }

  /**
   * Creates the owner of a register that has nobody. It signs nobody in.
   *
   * @param name how the owner is called
   * @param pin four to eight digits
   * @returns the owner
   * @throws Error if the register already has people, so nobody can take over a register by calling this
   * @throws RangeError if the name or the PIN is not valid
   */
  setupOwner(name: string, pin: string): UserSummary {
    if (!this.needsSetup()) {
      throw new Error('This register already has an owner');
    }
    return this.#create(name, 'owner', pin);
  }

  /**
   * Adds a person. Only the owner who is signed in can.
   *
   * @param name how the person is called
   * @param role what they can do
   * @param pin four to eight digits
   * @returns the new person
   * @throws Error if no owner is signed in
   * @throws RangeError if the name or the PIN is not valid
   */
  createUser(name: string, role: UserRole, pin: string): UserSummary {
    if (this.#current?.role !== 'owner') {
      throw new Error('Only the owner can add people');
    }
    return this.#create(name, role, pin);
  }

  /**
   * Signs a person in.
   *
   * @param userId the person
   * @param pin what they typed
   * @returns `ok`, or why not: a wrong PIN with the tries left, a lock, or a person that does not exist
   */
  login(userId: string, pin: string): LoginResult {
    const credentials = this.#users.find(userId);
    if (credentials === null) {
      return { status: 'unknown_user' };
    }
    const attempt = this.#check(credentials, pin);
    if (attempt.status !== 'ok') {
      return attempt;
    }
    this.#current = { id: credentials.id, name: credentials.name, role: credentials.role };
    return { status: 'ok', user: this.#current };
  }

  /** Signs out whoever is signed in. */
  logout(): void {
    this.#current = null;
  }

  /**
   * Checks the PIN of an owner for something that needs their approval, such as a return. Nobody is signed in or out.
   * Wrong PINs count against the owner whose PIN was closest to being right, so this box cannot be used to guess a PIN
   * without limit.
   *
   * @param pin what was typed
   * @returns the owner whose PIN it is, or why not
   */
  authorizeWithOwnerPin(pin: string): OwnerAuthorization {
    const owners = this.#users.owners();
    let lastRefusal: OwnerAuthorization = { status: 'wrong_pin', attemptsLeft: MAX_FAILED_ATTEMPTS };
    for (const owner of owners) {
      const attempt = this.#check(owner, pin);
      if (attempt.status === 'ok') {
        return { status: 'ok', owner: attempt.user };
      }
      if (attempt.status === 'locked' || attempt.status === 'wrong_pin') {
        lastRefusal = attempt;
      }
    }
    return lastRefusal;
  }

  #create(name: string, role: UserRole, pin: string): UserSummary {
    const trimmed = name.trim();
    if (trimmed === '' || [...trimmed].length > MAX_USER_NAME_LENGTH) {
      throw new RangeError(`A name has between 1 and ${MAX_USER_NAME_LENGTH} characters`);
    }
    return this.#users.create(trimmed, role, hashPin(pin));
  }

  #check(credentials: UserCredentials, pin: string): LoginResult {
    const now = this.#now();
    const isLocked = credentials.lockedUntil !== null && new Date(credentials.lockedUntil) > now;
    if (isLocked) {
      return { status: 'locked', until: credentials.lockedUntil! };
    }
    // A lock that is over starts the count again, so one slip after a lock does not lock the person for good.
    const failedBefore = credentials.lockedUntil === null ? credentials.failedAttempts : 0;
    if (verifyPin(pin, credentials.pinHash)) {
      this.#users.saveAttempts(credentials.id, 0, null);
      return { status: 'ok', user: { id: credentials.id, name: credentials.name, role: credentials.role } };
    }
    const failed = failedBefore + 1;
    if (failed >= MAX_FAILED_ATTEMPTS) {
      const until = new Date(now.getTime() + LOCK_MINUTES * MS_PER_MINUTE).toISOString();
      this.#users.saveAttempts(credentials.id, failed, until);
      return { status: 'wrong_pin', attemptsLeft: 0 };
    }
    this.#users.saveAttempts(credentials.id, failed, null);
    return { status: 'wrong_pin', attemptsLeft: MAX_FAILED_ATTEMPTS - failed };
  }
}
