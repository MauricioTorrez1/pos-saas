/** The base units of ADR 0011. A roll or a box converts to one of these. */
export const UNITS = ["piece", "meter", "kilogram", "liter"] as const;

/** A base unit: `piece`, `meter`, `kilogram`, or `liter`. */
export type Unit = (typeof UNITS)[number];

/**
 * Tells whether a value is a base unit, such as a unit read from the database.
 *
 * @param value - Anything.
 * @returns `true` if it is one of {@link UNITS}.
 */
export function isUnit(value: unknown): value is Unit {
  return (UNITS as readonly unknown[]).includes(value);
}
