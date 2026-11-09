import {
  compareCut,
  countCash,
  DEFAULT_WITHDRAWAL_LIMIT_CENTS,
  expectedCut,
  shouldWithdraw,
  type ExpectedCut,
} from '../../shared/cash';
import type {
  CashCut,
  CashMovementRequest,
  CashMovementResult,
  CashStatus,
  CloseCashRequest,
  CloseCashResult,
  OpenCashResult,
} from '../../shared/cash-api';
import type { UserSummary } from '../../shared/auth';
import type { AuthService } from '../auth/auth-service';
import type { CashSessionStore } from './cash-session-store';

const WITHDRAWAL_LIMIT_SETTING = 'cash_withdrawal_limit_cents';

function requireCents(value: number, description: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`Expected ${description} as a whole number of cents of at least ${minimum}, got ${value}`);
  }
}

function requireReason(reason: string): string {
  const trimmed = reason.trim();
  if (trimmed === '') {
    throw new RangeError('A reason cannot be empty');
  }
  return trimmed;
}

/**
 * The cash of the register: opening it with a float, what comes in and out of the drawer, the warning to withdraw cash,
 * and the cut that closes it. Everything is done by the person who is signed in, so every record carries their name
 * (RF-024, RF-025, RF-026, RF-027).
 */
export class CashService {
  readonly #store: CashSessionStore;
  readonly #auth: Pick<AuthService, 'currentUser' | 'authorizeWithOwnerPin'>;

  /**
   * @param store where the sessions are kept
   * @param auth who is signed in, and the check of an owner's PIN
   */
  constructor(store: CashSessionStore, auth: Pick<AuthService, 'currentUser' | 'authorizeWithOwnerPin'>) {
    this.#store = store;
    this.#auth = auth;
  }

  /**
   * Tells how the cash stands.
   *
   * @returns the open session with what moved in it, what a cut would expect, and whether to warn about a withdrawal
   */
  status(): CashStatus {
    const limit = this.#withdrawalLimit();
    const session = this.#store.findOpen();
    if (session === null) {
      return { session: null, totals: null, expected: null, withdrawalLimitCents: limit, shouldWithdraw: false };
    }
    const totals = this.#store.totals(session);
    const expected = expectedCut(totals);
    return {
      session: { id: session.id, openedBy: session.openedByName, openedAt: session.openedAt, openingFloatCents: session.openingFloatCents },
      totals,
      expected,
      withdrawalLimitCents: limit,
      shouldWithdraw: shouldWithdraw(expected.cashCents, limit),
    };
  }

  /** @returns the id of the open session, or null. Sales are only made while there is one. */
  openSessionId(): string | null {
    return this.#store.findOpen()?.id ?? null;
  }

  /**
   * Opens the register with the cash the cashier puts in the drawer (RF-024).
   *
   * @param floatCents the float, which may be zero
   * @returns `opened`, or `already_open` if somebody did already, because there is one session at a time
   * @throws RangeError if the float is not a whole number of cents
   * @throws Error if nobody is signed in
   */
  open(floatCents: number): OpenCashResult {
    const user = this.#requireUser();
    requireCents(floatCents, 'the float', 0);
    if (this.#store.findOpen() !== null) {
      return { status: 'already_open', cash: this.status() };
    }
    this.#store.open(user.id, floatCents);
    return { status: 'opened', cash: this.status() };
  }

  /**
   * Records cash going into or out of the drawer, with the reason (RF-025). A cashier needs the PIN of an owner to take
   * cash out, so nobody empties the drawer alone.
   *
   * @param request the kind, the amount, the reason, and the owner's PIN when it is needed
   * @returns `recorded` with the new totals, or why not
   * @throws RangeError if the amount is not positive or the reason is empty
   */
  recordMovement(request: CashMovementRequest): CashMovementResult {
    const user = this.#requireUser();
    requireCents(request.amountCents, 'an amount', 1);
    const reason = requireReason(request.reason);
    const session = this.#store.findOpen();
    if (session === null) {
      return { status: 'no_session' };
    }
    let authorizedBy: string | null = null;
    if (request.kind === 'out' && user.role !== 'owner') {
      if (request.ownerPin === undefined || request.ownerPin === '') {
        return { status: 'authorization_required' };
      }
      const authorization = this.#auth.authorizeWithOwnerPin(request.ownerPin);
      if (authorization.status !== 'ok') {
        return authorization;
      }
      authorizedBy = authorization.owner.id;
    }
    this.#store.addMovement(session.id, request.kind, request.amountCents, reason, user.id, authorizedBy);
    return { status: 'recorded', cash: this.status() };
  }

  /**
   * Makes the cut with what was counted, and closes the register (RF-027). A cut that does not balance needs a reason.
   *
   * @param request the bills and coins, the card and transfer vouchers, and the reason if it does not balance
   * @returns `closed` with the cut, or why not
   * @throws RangeError if a count is not valid
   * @throws Error if nobody is signed in
   */
  close(request: CloseCashRequest): CloseCashResult {
    const user = this.#requireUser();
    requireCents(request.cardCountedCents, 'the card total', 0);
    requireCents(request.transferCountedCents, 'the transfer total', 0);
    const counted: ExpectedCut = {
      cashCents: countCash(request.counts),
      cardCents: request.cardCountedCents,
      transferCents: request.transferCountedCents,
    };
    const session = this.#store.findOpen();
    if (session === null) {
      return { status: 'no_session' };
    }
    const pending = this.#store.pendingSalesCount();
    if (pending > 0) {
      return { status: 'pending_sales', count: pending };
    }
    const expected = expectedCut(this.#store.totals(session));
    const comparison = compareCut(expected, counted);
    const reason = request.reason.trim();
    if (!comparison.isBalanced && reason === '') {
      return { status: 'reason_required', comparison };
    }
    const saved = this.#store.close(session.id, {
      cutBy: user.id,
      expected,
      counted,
      denominations: request.counts,
      reason: comparison.isBalanced ? null : reason,
    });
    const cut: CashCut = { ...comparison, id: saved.id, cutAt: saved.cutAt, cutBy: user.name, reason: comparison.isBalanced ? null : reason };
    return { status: 'closed', cut };
  }

  /**
   * Changes the cash level that triggers the withdrawal warning (RF-026). Only the owner decides it.
   *
   * @param limitCents the new limit, in cents
   * @returns the new status
   * @throws Error if the person signed in is not the owner
   * @throws RangeError if the limit is not a positive whole number of cents
   */
  setWithdrawalLimit(limitCents: number): CashStatus {
    if (this.#requireUser().role !== 'owner') {
      throw new Error('Only the owner can change the withdrawal limit');
    }
    requireCents(limitCents, 'the limit', 1);
    this.#store.writeSetting(WITHDRAWAL_LIMIT_SETTING, String(limitCents));
    return this.status();
  }

  #withdrawalLimit(): number {
    const saved = this.#store.readSetting(WITHDRAWAL_LIMIT_SETTING);
    const parsed = saved === null ? Number.NaN : Number(saved);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_WITHDRAWAL_LIMIT_CENTS;
  }

  #requireUser(): UserSummary {
    const user = this.#auth.currentUser();
    if (user === null) {
      throw new Error('Sign in first');
    }
    return user;
  }
}
