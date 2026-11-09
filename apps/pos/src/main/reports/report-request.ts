/**
 * Checks the day of a report that came over the bridge. The service checks that the day exists; this checks the shape.
 *
 * @param value what the screen sent
 * @returns the day as `YYYY-MM-DD`
 * @throws TypeError if it is not text in that form
 */
export function requireDayText(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError('Expected a day as YYYY-MM-DD');
  }
  return value;
}
