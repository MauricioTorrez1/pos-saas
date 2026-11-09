import type { Unit } from '@pos-saas/money';

import type { PolicyViolation, RefundablePart, RefundShare } from './returns';

/** One line of a sale, with how much of it can still come back. */
export interface ReturnableLine {
  /** UUIDv7 of the line. */
  readonly saleLineId: string;
  readonly productName: string;
  readonly unit: Unit;
  readonly soldMilli: number;
  /** What came back in earlier returns. */
  readonly returnedMilli: number;
  /** What can still come back. A return can never bring back more than was sold. */
  readonly returnableMilli: number;
  /** Price per unit with VAT, in ten-thousandths of a peso. */
  readonly unitPriceE4: number;
  readonly lineTotalCents: number;
  /** What was already given back for this line. */
  readonly refundedCents: number;
}

/** A completed sale found by its folio, with what a return needs to know about it. */
export interface ReturnableSale {
  /** UUIDv7 of the sale. */
  readonly saleId: string;
  /** The short folio on the ticket, such as `T1-000123`. */
  readonly folio: string;
  readonly completedAt: string;
  readonly totalCents: number;
  /** Whole days since the sale. */
  readonly daysOld: number;
  readonly lines: readonly ReturnableLine[];
  /** The means the customer paid with and how much of each can still be given back. */
  readonly parts: readonly RefundablePart[];
  /** The rules this return breaks. It needs the owner to override them (RF-019). */
  readonly violations: readonly PolicyViolation[];
}

/** How looking for a sale to return ended. */
export type FindReturnableResult =
  | { readonly status: 'found'; readonly sale: ReturnableSale }
  | { readonly status: 'not_found' }
  /** What was typed is not a folio. */
  | { readonly status: 'invalid_folio' };

/** What comes back from the customer. */
export interface ReturnRequest {
  /** UUIDv7 of the sale. */
  readonly saleId: string;
  readonly lines: readonly { readonly saleLineId: string; readonly quantityMilli: number }[];
  /** Why it comes back. It stays with the return. */
  readonly reason: string;
  /** The PIN of an owner. A cashier needs it, because the owner authorizes every return. */
  readonly ownerPin?: string;
  /** The owner agrees to a return that breaks the rules of the window or of measured products. */
  readonly override?: boolean;
}

/** How a return ended. */
export type ReturnResult =
  | {
      readonly status: 'returned';
      /** UUIDv7 of the return. */
      readonly returnId: string;
      readonly totalCents: number;
      /** What is given back, by the same means the customer paid with. */
      readonly refunds: readonly RefundShare[];
    }
  | { readonly status: 'no_session' }
  | { readonly status: 'authorization_required' }
  | { readonly status: 'wrong_pin'; readonly attemptsLeft: number }
  | { readonly status: 'locked'; readonly until: string }
  /** The return breaks a rule, and the owner did not override it. */
  | { readonly status: 'needs_override'; readonly violations: readonly PolicyViolation[] }
  /** More was asked to come back than was sold. */
  | { readonly status: 'exceeds_sold' }
  | { readonly status: 'nothing_selected' }
  | { readonly status: 'not_found' };
