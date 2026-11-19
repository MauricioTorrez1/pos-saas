/**
 * The day whose sales a session captures (E1-60, ADR 0076). Most sessions sell today; when the cashier could not ring up
 * every sale, the owner lets them capture a recent past day the next morning, and every sale of that session counts on it.
 */

/** How many days back a capture may go, counting yesterday as the first. */
export const BACKDATE_WINDOW_DAYS = 7;

/** The PIN of an owner, when a cashier asks to capture a past day. */
export interface CaptureDayRequest {
  /** `YYYY-MM-DD`, one of the days the sign-in screen offers. */
  readonly day: string;
  readonly ownerPin?: string;
}

/** Why a past day was refused at the sign-in. Nobody is signed in when one is answered. */
export type CaptureDayRefusal =
  /** The day is in the future, older than the window, or before the register started. */
  | { readonly status: 'day_out_of_range' }
  /** A cashier asked for a past day without the PIN of an owner. */
  | { readonly status: 'owner_pin_required' }
  | { readonly status: 'owner_wrong_pin'; readonly attemptsLeft: number }
  | { readonly status: 'owner_locked'; readonly until: string };

const DAY_LABEL = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Names a day the way the banner and the ticket say it, such as «martes 17 de noviembre».
 *
 * @param day `YYYY-MM-DD`
 * @returns the day in words, or the text as it came when it is not a day
 */
export function captureDayLabel(day: string): string {
  if (!DAY_TEXT.test(day)) {
    return day;
  }
  const civil = Date.parse(`${day}T00:00:00Z`);
  // es-MX writes «martes, 17 de noviembre»; the comma is dropped so the banner and the ticket read as one phrase.
  return Number.isNaN(civil) ? day : DAY_LABEL.format(new Date(civil)).replace(',', '');
}

/**
 * The line a ticket of a backdated sale prints under the header.
 *
 * @param day `YYYY-MM-DD`
 * @returns «Captura atrasada del martes 17 de noviembre»
 */
export function backdatedTicketLine(day: string): string {
  return `Captura atrasada del ${captureDayLabel(day)}`;
}
