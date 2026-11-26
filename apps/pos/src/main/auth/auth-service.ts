import { MAX_USER_NAME_LENGTH, type LoginResult, type UserRole, type UserSummary } from '../../shared/auth';
import { captureDayLabel, type CaptureDayRequest, type PastCaptureDay } from '../../shared/capture-day';
import { formatCents } from '@pos-saas/money';
import type { AuditEntry } from '../audit/audit-log';
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

/** Which days a session may capture (E1-60). */
export interface CaptureDayPolicy {
  /** @returns the days a session may capture, today first */
  allowed(): string[];
  /** @returns how each past day stands: its unfinished session and its cuts (E1-61) */
  pastDays?(): PastCaptureDay[];
}

/** What else the sign-in needs besides the people. */
export interface AuthOptions {
  /** The days a session may capture. Without it, every session sells today. */
  readonly captureDays?: CaptureDayPolicy;
  /** Where a sign-in to a past day is written down, with who approved it. */
  readonly audit?: { record(entry: AuditEntry): void };
}

/**
 * Who is signed in at this register. People enter with a PIN checked against a hash kept in the local database, so it
 * works without internet (ADR 0006). The person who is signed in lives in memory only: closing the register signs them
 * out, and the next one starts with their own PIN.
 */
export class AuthService {
  readonly #users: UserStore;
  readonly #now: () => Date;
  readonly #captureDays: CaptureDayPolicy | null;
  readonly #audit: { record(entry: AuditEntry): void } | null;
  #current: UserSummary | null = null;
  #captureDay: string | null = null;
  #signInDay: string | null = null;

  /**
   * @param users where the people and their hashes are kept
   * @param now the clock, so a test can move time
   * @param options the days a session may capture and the audit log
   */
  constructor(users: UserStore, now: () => Date = () => new Date(), options: AuthOptions = {}) {
    this.#users = users;
    this.#now = now;
    this.#captureDays = options.captureDays ?? null;
    this.#audit = options.audit ?? null;
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

  /** @returns the past day this session captures, or null when it sells today (E1-60) */
  captureDay(): string | null {
    return this.#current === null ? null : this.#captureDay;
  }

  /**
   * @returns the day whose cash this person works on: the past day they capture, or the day they signed in, so a shift that
   *   goes past midnight keeps its drawer (E1-61). Null when nobody is signed in or the register has no policy of days.
   */
  workDay(): string | null {
    return this.#current === null ? null : (this.#captureDay ?? this.#signInDay);
  }

  /** @returns the days the sign-in offers, today first; none when the register has no policy, so it only sells today */
  captureDayOptions(): string[] {
    return this.#captureDays?.allowed() ?? [];
  }

  /** @returns how each past day the sign-in offers stands, so the screen says what choosing it does (E1-61) */
  pastCaptureDays(): PastCaptureDay[] {
    return this.#captureDays?.pastDays?.() ?? [];
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
   * Signs a person in, to sell today or to capture the sales of a recent past day (E1-60, ADR 0076). A past day must be
   * one the policy offers, and needs the approval of an owner: the owner who signs in gives it, and a cashier types the PIN
   * of one. A past day left without its cut is resumed: the cash works on that very session. A day that was already cut
   * and has no unfinished session asks first, and only a sign-in that agrees to a supplementary capture goes on (E1-61,
   * ADR 0077). Nobody is signed in when anything is refused.
   *
   * @param userId the person
   * @param pin what they typed
   * @param capture the day to capture and the PIN of an owner, when it is not today
   * @returns `ok`, or why not: a wrong PIN with the tries left, a lock, a person that does not exist, or a refused day
   */
  login(userId: string, pin: string, capture?: CaptureDayRequest): LoginResult {
    const credentials = this.#users.find(userId);
    if (credentials === null) {
      return { status: 'unknown_user' };
    }
    const pastDay = this.#pastDayOf(capture);
    if (pastDay === undefined) {
      return { status: 'day_out_of_range' };
    }
    const dayState = pastDay === null ? undefined : this.pastCaptureDays().find(({ day }) => day === pastDay);
    const isCutDay = dayState !== undefined && dayState.unfinished === null && dayState.cutCount > 0;
    if (isCutDay && capture?.supplementary !== true) {
      return { status: 'day_already_cut' };
    }
    const attempt = this.#check(credentials, pin);
    if (attempt.status !== 'ok') {
      return attempt;
    }
    let approvedBy = credentials.id;
    if (pastDay !== null && credentials.role !== 'owner') {
      const approval = this.#approvePastDay(capture?.ownerPin);
      if (approval.status !== 'ok') {
        return approval;
      }
      approvedBy = approval.ownerId;
    }
    this.#current = { id: credentials.id, name: credentials.name, role: credentials.role };
    this.#captureDay = pastDay;
    this.#signInDay = this.#captureDays?.allowed()[0] ?? null;
    if (pastDay !== null) {
      const kind = isCutDay ? ' en una captura suplementaria, porque ese día ya tiene corte' : '';
      this.#audit?.record({
        userId: credentials.id,
        action: 'session.backdated_capture',
        entity: 'business_day',
        entityId: pastDay,
        detail: `${credentials.name} entró a capturar las ventas del ${captureDayLabel(pastDay)}${kind}; autorizó ${approvedBy}`,
      });
    }
    const unfinished = dayState?.unfinished ?? null;
    if (pastDay !== null && unfinished !== null) {
      this.#audit?.record({
        userId: credentials.id,
        action: 'cash_session.resumed',
        entity: 'cash_session',
        entityId: unfinished.sessionId,
        detail:
          `${credentials.name} retomó la caja sin corte del ${captureDayLabel(pastDay)} que abrió ${unfinished.openedBy} ` +
          `con un fondo de ${formatCents(unfinished.openingFloatCents)}; autorizó ${approvedBy}`,
      });
    }
    return { status: 'ok', user: this.#current };
  }

  /** The past day asked for: null for today, undefined for a day the policy does not offer. */
  #pastDayOf(capture: CaptureDayRequest | undefined): string | null | undefined {
    if (capture === undefined) {
      return null;
    }
    const days = this.#captureDays?.allowed() ?? [];
    if (capture.day === days[0]) {
      return null;
    }
    return days.slice(1).includes(capture.day) ? capture.day : undefined;
  }

  #approvePastDay(ownerPin: string | undefined): { readonly status: 'ok'; readonly ownerId: string } | Exclude<LoginResult, { status: 'ok' }> {
    if (ownerPin === undefined || ownerPin === '') {
      return { status: 'owner_pin_required' };
    }
    const authorization = this.authorizeWithOwnerPin(ownerPin);
    switch (authorization.status) {
      case 'ok':
        return { status: 'ok', ownerId: authorization.owner.id };
      case 'wrong_pin':
        return { status: 'owner_wrong_pin', attemptsLeft: authorization.attemptsLeft };
      case 'locked':
        return { status: 'owner_locked', until: authorization.until };
    }
  }

  /** Signs out whoever is signed in. */
  logout(): void {
    this.#current = null;
    this.#captureDay = null;
    this.#signInDay = null;
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
