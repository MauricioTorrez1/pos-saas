import { allocateRefund, daysBetween, policyViolations, refundForLine, type RefundablePart } from '../../shared/returns';
import type {
  FindReturnableResult,
  ReturnableLine,
  ReturnableSale,
  ReturnRequest,
  ReturnResult,
} from '../../shared/returns-api';
import type { UserSummary } from '../../shared/auth';
import type { AuthService } from '../auth/auth-service';
import type { CashService } from '../cash/cash-service';
import { formatFolio } from '../checkout/ticket/ticket';
import type { ReturnLineRow, ReturnStore } from './return-store';

/** `T1-000123`, `t1-123`, or just `123`: whatever a customer reads from the ticket. */
const FOLIO_TEXT = /^(?:t1-)?([0-9]{1,9})$/i;

/**
 * Takes back what a customer returns, as a record next to the sale: a completed sale never changes (a compensating
 * transaction). The owner authorizes every return, it is refused by default after 30 days or for products sold by length
 * or weight, and it can never bring back more than was sold (RF-019, ADR 0030).
 */
export class ReturnService {
  readonly #store: ReturnStore;
  readonly #auth: Pick<AuthService, 'currentUser' | 'authorizeWithOwnerPin'>;
  readonly #cash: Pick<CashService, 'openSessionId'>;
  readonly #now: () => Date;

  /**
   * @param store where the returns are kept
   * @param auth who is signed in, and the check of an owner's PIN
   * @param cash the open cash session, because a refund is paid out of it
   * @param now the clock, so a test can move time
   */
  constructor(
    store: ReturnStore,
    auth: Pick<AuthService, 'currentUser' | 'authorizeWithOwnerPin'>,
    cash: Pick<CashService, 'openSessionId'>,
    now: () => Date = () => new Date(),
  ) {
    this.#store = store;
    this.#auth = auth;
    this.#cash = cash;
    this.#now = now;
  }

  /**
   * Finds the sale a customer wants to return from the folio on their ticket.
   *
   * @param text what was typed: `T1-000123`, or just `123`
   * @returns the sale with what can still come back from each line, or why it was not found
   */
  findSale(text: string): FindReturnableResult {
    const match = FOLIO_TEXT.exec(text.trim());
    if (match === null) {
      return { status: 'invalid_folio' };
    }
    const row = this.#store.findCompletedByFolio(Number(match[1]));
    if (row === null) {
      return { status: 'not_found' };
    }
    const lines = this.#store.lines(row.id).map(toReturnableLine);
    const daysOld = daysBetween(row.completedAt, this.#now());
    return {
      status: 'found',
      sale: {
        saleId: row.id,
        folio: formatFolio(row.folio),
        completedAt: row.completedAt,
        totalCents: row.totalCents,
        daysOld,
        lines,
        parts: this.#parts(row.id),
        violations: policyViolations({ daysOld, hasMeasuredProduct: lines.some(({ unit }) => unit !== 'piece') }),
      } satisfies ReturnableSale,
    };
  }

  /**
   * Records a return and works out what is given back, by the same means the customer paid with.
   *
   * @param request the sale, what comes back from each line, the reason, and the authorization
   * @returns `returned` with what to give back, or why not
   * @throws Error if nobody is signed in
   * @throws RangeError if a quantity is not valid for its product
   */
  create(request: ReturnRequest): ReturnResult {
    const user = this.#requireUser();
    const cashSessionId = this.#cash.openSessionId();
    if (cashSessionId === null) {
      return { status: 'no_session' };
    }
    const reason = request.reason.trim();
    if (reason === '') {
      throw new RangeError('A return needs its reason');
    }
    const requested = mergeLines(request.lines);
    if (requested.length === 0) {
      return { status: 'nothing_selected' };
    }
    const sale = this.#store.findCompletedById(request.saleId);
    if (sale === null) {
      return { status: 'not_found' };
    }
    const lines = this.#store.lines(sale.id);
    const selected = this.#select(lines, requested);
    if (selected === null) {
      return { status: 'exceeds_sold' };
    }

    const authorization = this.#authorize(user, request.ownerPin);
    if ('status' in authorization) {
      return authorization;
    }
    const violations = policyViolations({
      daysOld: daysBetween(sale.completedAt, this.#now()),
      hasMeasuredProduct: selected.some(({ line }) => line.unit !== 'piece'),
    });
    if (violations.length > 0 && request.override !== true) {
      return { status: 'needs_override', violations };
    }

    const refunds = selected.map(({ line, quantityMilli }) => ({
      saleLineId: line.id,
      quantityMilli,
      refundCents: refundForLine({
        lineTotalCents: line.lineTotalCents,
        soldMilli: line.soldMilli,
        returnMilli: quantityMilli,
        alreadyReturnedMilli: line.returnedMilli,
        alreadyRefundedCents: line.refundedCents,
      }),
    }));
    const totalCents = refunds.reduce((sum, { refundCents }) => sum + refundCents, 0);
    const parts = this.#parts(sale.id);
    if (totalCents <= 0 || totalCents > parts.reduce((sum, part) => sum + part.remainingCents, 0)) {
      return { status: 'exceeds_sold' };
    }
    const shares = allocateRefund(totalCents, parts);
    const returnId = this.#store.insert({
      saleId: sale.id,
      cashSessionId,
      requestedBy: user.id,
      authorizedBy: authorization.ownerId,
      reason,
      totalCents,
      lines: refunds,
      refunds: shares,
    });
    return { status: 'returned', returnId, totalCents, refunds: shares };
  }

  #parts(saleId: string): RefundablePart[] {
    return this.#store
      .payments(saleId)
      .map(({ method, reference, paidCents, refundedCents }) => ({ method, reference, remainingCents: paidCents - refundedCents }));
  }

  #select(lines: readonly ReturnLineRow[], requested: readonly { saleLineId: string; quantityMilli: number }[]): { line: ReturnLineRow; quantityMilli: number }[] | null {
    const selected: { line: ReturnLineRow; quantityMilli: number }[] = [];
    for (const { saleLineId, quantityMilli } of requested) {
      const line = lines.find(({ id }) => id === saleLineId);
      if (line === undefined || quantityMilli > line.soldMilli - line.returnedMilli) {
        return null;
      }
      if (line.unit === 'piece' && quantityMilli % 1000 !== 0) {
        throw new RangeError('Pieces come back whole');
      }
      selected.push({ line, quantityMilli });
    }
    return selected;
  }

  /** The owner authorizes every return: an owner who is signed in authorizes it by asking, and a cashier needs the PIN. */
  #authorize(user: UserSummary, ownerPin: string | undefined): { ownerId: string } | Extract<ReturnResult, { status: 'authorization_required' | 'wrong_pin' | 'locked' }> {
    if (user.role === 'owner') {
      return { ownerId: user.id };
    }
    if (ownerPin === undefined || ownerPin === '') {
      return { status: 'authorization_required' };
    }
    const result = this.#auth.authorizeWithOwnerPin(ownerPin);
    return result.status === 'ok' ? { ownerId: result.owner.id } : result;
  }

  #requireUser(): UserSummary {
    const user = this.#auth.currentUser();
    if (user === null) {
      throw new Error('Sign in first');
    }
    return user;
  }
}

function toReturnableLine(row: ReturnLineRow): ReturnableLine {
  return {
    saleLineId: row.id,
    productName: row.productName,
    unit: row.unit,
    soldMilli: row.soldMilli,
    returnedMilli: row.returnedMilli,
    returnableMilli: row.soldMilli - row.returnedMilli,
    unitPriceE4: row.unitPriceE4,
    lineTotalCents: row.lineTotalCents,
    refundedCents: row.refundedCents,
  };
}

/** The same line twice is one return of the sum, so the limit is checked once against what was sold. */
function mergeLines(lines: ReturnRequest['lines']): { saleLineId: string; quantityMilli: number }[] {
  const merged = new Map<string, number>();
  for (const { saleLineId, quantityMilli } of lines) {
    if (!Number.isSafeInteger(quantityMilli) || quantityMilli < 0) {
      throw new RangeError('A quantity is a whole number of thousandths');
    }
    if (quantityMilli > 0) {
      merged.set(saleLineId, (merged.get(saleLineId) ?? 0) + quantityMilli);
    }
  }
  return [...merged].map(([saleLineId, quantityMilli]) => ({ saleLineId, quantityMilli }));
}
