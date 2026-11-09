import type { CashTotals, CutComparison, ExpectedCut } from './cash';

/** What a cut found, form of payment by form of payment. */
export type CutComparisonView = CutComparison;

/** A cash session that is open now. */
export interface CashSessionView {
  /** UUIDv7 of the session. */
  readonly id: string;
  /** Who opened it, by name. */
  readonly openedBy: string;
  /** When it opened, in ISO 8601. */
  readonly openedAt: string;
  readonly openingFloatCents: number;
}

/** How the cash of the register stands. */
export interface CashStatus {
  /** The open session, or null when the register is closed and cannot sell. */
  readonly session: CashSessionView | null;
  /** What moved in the open session. Null when there is none. */
  readonly totals: CashTotals | null;
  /** What a cut would expect right now. Null when there is no open session. */
  readonly expected: ExpectedCut | null;
  /** The cash in the drawer above which the register asks for a withdrawal. */
  readonly withdrawalLimitCents: number;
  /** True when the expected cash is above the limit. It warns, and never stops a sale (RF-026). */
  readonly shouldWithdraw: boolean;
}

/** An entry puts cash into the drawer and an exit takes it out. */
export type CashMovementKind = 'in' | 'out';

/** A cash entry or exit, with the reason that makes it auditable (RF-025). */
export interface CashMovementRequest {
  readonly kind: CashMovementKind;
  readonly amountCents: number;
  readonly reason: string;
  /** The PIN of an owner. A cashier needs it to take cash out. */
  readonly ownerPin?: string;
}

/** How opening the register ended. */
export type OpenCashResult =
  | { readonly status: 'opened'; readonly cash: CashStatus }
  | { readonly status: 'already_open'; readonly cash: CashStatus };

/** How recording a cash entry or exit ended. */
export type CashMovementResult =
  | { readonly status: 'recorded'; readonly cash: CashStatus }
  | { readonly status: 'no_session' }
  /** A cashier took cash out without an owner's PIN. */
  | { readonly status: 'authorization_required' }
  | { readonly status: 'wrong_pin'; readonly attemptsLeft: number }
  | { readonly status: 'locked'; readonly until: string };

/** What was counted for the cut: the bills and coins, and the vouchers of the card and the transfers. */
export interface CloseCashRequest {
  /** How many of each bill and coin, keyed by its value in cents. */
  readonly counts: Readonly<Record<number, number>>;
  readonly cardCountedCents: number;
  readonly transferCountedCents: number;
  /** Why the cut does not balance. Required when any form of payment is off. */
  readonly reason: string;
}

/** The cut that was saved. */
export interface CashCut extends CutComparison {
  /** UUIDv7 of the cut. */
  readonly id: string;
  /** When it was made, in ISO 8601. */
  readonly cutAt: string;
  readonly cutBy: string;
  readonly reason: string | null;
}

/** How closing the register ended. */
export type CloseCashResult =
  | { readonly status: 'closed'; readonly cut: CashCut }
  /** The cut does not balance and no reason was given. Nothing was closed. */
  | { readonly status: 'reason_required'; readonly comparison: CutComparison }
  /** A sale is still waiting for its answer, so the totals are not final yet. */
  | { readonly status: 'pending_sales'; readonly count: number }
  | { readonly status: 'no_session' };
