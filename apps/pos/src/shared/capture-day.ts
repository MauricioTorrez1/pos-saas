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
  /**
   * True when the person agreed to a supplementary capture of a day that was already cut (E1-61, ADR 0077). Without it, a
   * cut day is refused with `day_already_cut`, so a new session never opens without the person knowing.
   */
  readonly supplementary?: boolean;
}

/** A cash session of a past day that was left without its cut, which signing in to that day resumes (E1-61). */
export interface UnfinishedSession {
  /** UUIDv7 of the session, which stays the same when it is resumed. */
  readonly sessionId: string;
  /** Who opened it, by name. */
  readonly openedBy: string;
  /** When it opened, in ISO 8601. */
  readonly openedAt: string;
  readonly openingFloatCents: number;
}

/** How a past day stands, so the sign-in can say what choosing it does (E1-61, ADR 0077). */
export interface PastCaptureDay {
  /** `YYYY-MM-DD`. */
  readonly day: string;
  /** The session of that day left without a cut, which choosing the day resumes; null when there is none. */
  readonly unfinished: UnfinishedSession | null;
  /** How many cuts that day already has. With no unfinished session, choosing it asks for a supplementary capture. */
  readonly cutCount: number;
}

/** Why a past day was refused at the sign-in. Nobody is signed in when one is answered. */
export type CaptureDayRefusal =
  /** The day is in the future, older than the window, or before the register started. */
  | { readonly status: 'day_out_of_range' }
  /** A cashier asked for a past day without the PIN of an owner. */
  | { readonly status: 'owner_pin_required' }
  | { readonly status: 'owner_wrong_pin'; readonly attemptsLeft: number }
  | { readonly status: 'owner_locked'; readonly until: string }
  /** The day was already cut and has no unfinished session; signing in again with `supplementary` adds to it (E1-61). */
  | { readonly status: 'day_already_cut' };

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
