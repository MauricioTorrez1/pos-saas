import { readScaledInteger } from "./decimal-text.js";
import { MoneyError } from "./money-error.js";
import { isUnit, type Unit } from "./unit.js";
import { requireNonNegativeInteger } from "./value-limits.js";

const QUANTITY_DECIMALS = 3;
const MILLI_PER_UNIT = 1000;

/**
 * An amount of something, in thousandths of its base unit: 3.275 m is `{ milli: 3275, unit: "meter" }`.
 *
 * It is plain data, so it survives the bridge to the screen and a row of SQLite unchanged.
 */
export interface Quantity {
  readonly milli: number;
  readonly unit: Unit;
}

/**
 * Creates a quantity after checking it. Pieces are whole, as with the products sold by unit in Eleventa.
 *
 * @param milli - Thousandths of the unit: 3.275 m is 3275, and 7 pieces are 7000.
 * @param unit - The base unit.
 * @returns The quantity.
 * @throws {MoneyError} `not_an_integer`, `negative_input`, `unknown_unit`, or `fractional_piece`.
 */
export function quantityOf(milli: number, unit: Unit): Quantity {
  requireNonNegativeInteger(milli, "a quantity in thousandths");
  if (!isUnit(unit)) {
    throw new MoneyError("unknown_unit", `Expected piece, meter, kilogram, or liter, got ${String(unit)}`);
  }
  if (unit === "piece" && milli % MILLI_PER_UNIT !== 0) {
    throw new MoneyError("fractional_piece", `Pieces are whole, got ${milli} thousandths of a piece`);
  }
  return { milli, unit };
}

/**
 * Reads a quantity typed as text: "3.275" in meters is 3275 thousandths.
 *
 * @param text - Digits with up to 3 decimals, as described in `readScaledInteger`.
 * @param unit - The base unit.
 * @returns The quantity.
 * @throws {MoneyError} `invalid_format`, `too_many_decimals`, `overflow`, `unknown_unit`, or `fractional_piece`.
 */
export function parseQuantity(text: string, unit: Unit): Quantity {
  return quantityOf(readScaledInteger(text, QUANTITY_DECIMALS), unit);
}
