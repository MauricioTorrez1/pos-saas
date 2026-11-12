/** An entry with a cost in the local ledger, with the stock the product had right before it. */
export interface CostedEntry {
  /** Thousandths of the unit that came in, above zero. */
  readonly quantityMilli: number;
  /** Cost per unit in millionths of a peso. */
  readonly unitCostE6: number;
  /** The stock of the product just before this entry, which may be zero or below. */
  readonly stockBeforeMilli: number;
}

/** A cent is 10 million of quantity (thousandths) times cost (millionths). */
export const COST_DIVISOR = 10_000_000n;

/**
 * Divides rounding half up, for non-negative numbers, with no floating point (ADR 0011).
 *
 * @param numerator what to divide
 * @param denominator what to divide by, above zero
 * @returns the quotient rounded half up
 */
export function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

/**
 * The moving weighted average cost of a product, the same rule the core uses (ADR 0049) applied to the entries with a
 * cost that the register has. Sales and returns have no cost here: they only change how much stock an entry mixes with.
 * - An entry over positive stock: `round_half_up((stock × average + quantity × cost) / (stock + quantity))`.
 * - An entry over stock at zero or below: the units that were missing were already sold, so what is left is all of this
 *   entry and the average is its cost. If it still leaves the stock at zero or below, the average is kept.
 * - The first entry with a cost sets the average.
 *
 * @param entries the entries with a cost, oldest first
 * @returns the average in millionths of a peso, or null when there is no entry with a cost
 */
export function averageCostE6(entries: readonly CostedEntry[]): number | null {
  let average: bigint | null = null;
  for (const entry of entries) {
    const cost = BigInt(entry.unitCostE6);
    const quantity = BigInt(entry.quantityMilli);
    const stock = BigInt(entry.stockBeforeMilli);
    if (average === null) {
      average = cost;
    } else if (stock <= 0n) {
      average = stock + quantity > 0n ? cost : average;
    } else {
      average = divideHalfUp(stock * average + quantity * cost, stock + quantity);
    }
  }
  return average === null ? null : Number(average);
}

/**
 * What an amount of a product costs at a cost per unit, rounded half up to the cent.
 *
 * @param quantityMilli thousandths of the unit, zero or more
 * @param unitCostE6 cost per unit in millionths of a peso
 * @returns cents
 */
export function costInCents(quantityMilli: number, unitCostE6: number): number {
  return Number(divideHalfUp(BigInt(quantityMilli) * BigInt(unitCostE6), COST_DIVISOR));
}
