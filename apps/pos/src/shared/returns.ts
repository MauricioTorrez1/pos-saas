/** How many days after a sale it can still be returned without the owner overriding the rule (RF-019). */
export const RETURN_WINDOW_DAYS = 30;

const MS_PER_DAY = 86_400_000;

/** Why a return needs the owner to override, by default (RF-019). */
export type PolicyViolation = 'older_than_window' | 'measured_product';

/** The means a customer paid with, and how much of it can still be given back. */
export interface RefundablePart {
  readonly method: 'cash' | 'transfer' | 'card' | 'card_manual';
  readonly reference: string | null;
  /** What was paid with this means, less what was already given back by it. */
  readonly remainingCents: number;
}

/** What is given back by one means. */
export interface RefundShare {
  readonly method: RefundablePart['method'];
  readonly reference: string | null;
  readonly amountCents: number;
}

/** What it takes to work out the refund of one line. */
export interface LineRefundInput {
  /** What the customer paid for the whole line. */
  readonly lineTotalCents: number;
  readonly soldMilli: number;
  /** What comes back now. */
  readonly returnMilli: number;
  /** What came back before, in earlier returns. */
  readonly alreadyReturnedMilli: number;
  /** What was given back before for this line. */
  readonly alreadyRefundedCents: number;
}

/**
 * Works out what a line gives back: its share of what was paid, rounded half up. When the last part of a line comes back,
 * it gives back whatever is left of what was paid, so the refunds of a line never add up to more or less than it cost
 * (a compensating transaction, never an edit of the sale).
 *
 * @param input the line, what comes back, and what came back before
 * @returns the refund in cents
 * @throws RangeError if nothing comes back, or more than is left to return
 */
export function refundForLine(input: LineRefundInput): number {
  const { lineTotalCents, soldMilli, returnMilli, alreadyReturnedMilli, alreadyRefundedCents } = input;
  if (!Number.isSafeInteger(returnMilli) || returnMilli <= 0) {
    throw new RangeError('Something has to come back');
  }
  if (returnMilli > soldMilli - alreadyReturnedMilli) {
    throw new RangeError(`Only ${soldMilli - alreadyReturnedMilli} thousandths are left to return, got ${returnMilli}`);
  }
  if (returnMilli === soldMilli - alreadyReturnedMilli) {
    return lineTotalCents - alreadyRefundedCents;
  }
  // BigInt, because the product passes the largest safe integer long before the amounts are unreasonable.
  const numerator = BigInt(lineTotalCents) * BigInt(returnMilli);
  const denominator = BigInt(soldMilli);
  return Number((numerator * 2n + denominator) / (denominator * 2n));
}

/**
 * Splits a refund among the means the customer paid with, in proportion to what each one paid and still can give back,
 * so a mixed payment of $60 in cash and $40 by transfer gets $60 and $40 back. The parts always add up to the refund.
 *
 * @param refundCents what is given back, positive
 * @param parts the means of the sale and what is left to give back by each
 * @returns the share of each means that gives something back
 * @throws RangeError if the refund is not positive or is more than is left to give back
 */
export function allocateRefund(refundCents: number, parts: readonly RefundablePart[]): RefundShare[] {
  const total = parts.reduce((sum, part) => sum + part.remainingCents, 0);
  if (!Number.isSafeInteger(refundCents) || refundCents <= 0 || refundCents > total) {
    throw new RangeError(`A refund must be between 1 and ${total} cents, got ${refundCents}`);
  }
  const shares = parts.map((part) => {
    const scaled = BigInt(refundCents) * BigInt(part.remainingCents);
    return { floor: Number(scaled / BigInt(total)), remainder: Number(scaled % BigInt(total)) };
  });
  let leftover = refundCents - shares.reduce((sum, share) => sum + share.floor, 0);
  const byLargestRemainder = shares
    .map((share, index) => ({ index, remainder: share.remainder }))
    .sort((first, second) => second.remainder - first.remainder || first.index - second.index);
  const amounts = shares.map((share) => share.floor);
  for (const { index } of byLargestRemainder) {
    if (leftover === 0) {
      break;
    }
    if (amounts[index]! < parts[index]!.remainingCents) {
      amounts[index] = amounts[index]! + 1;
      leftover -= 1;
    }
  }
  return parts
    .map((part, index) => ({ method: part.method, reference: part.reference, amountCents: amounts[index]! }))
    .filter((share) => share.amountCents > 0);
}

/**
 * Counts the whole days between a sale and now.
 *
 * @param completedAt when the sale was completed, in ISO 8601
 * @param now the moment to count to
 * @returns the days, rounded down
 */
export function daysBetween(completedAt: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(completedAt).getTime()) / MS_PER_DAY);
}

/**
 * Tells which rules of a return are broken. A return that breaks one is refused by default, and only the owner can
 * override it (RF-019).
 *
 * @param facts how old the sale is, and whether it has a product sold by length, weight, or volume
 * @returns the broken rules, empty when the return is allowed
 */
export function policyViolations(facts: { readonly daysOld: number; readonly hasMeasuredProduct: boolean }): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  if (facts.daysOld > RETURN_WINDOW_DAYS) {
    violations.push('older_than_window');
  }
  if (facts.hasMeasuredProduct) {
    violations.push('measured_product');
  }
  return violations;
}
