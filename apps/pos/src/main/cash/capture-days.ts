import { BACKDATE_WINDOW_DAYS } from '../../shared/capture-day';
import type { LocalStore } from '../local-store/local-store';
import { dayText, localDayOf, parseDay } from '../reports/period';

const MS_PER_DAY = 86_400_000;

/**
 * Lists the days a session may capture: today first, then each past day back to the window or to the day the register
 * first opened its cash, whichever is later. A future day is never offered.
 *
 * @param today `YYYY-MM-DD` in the time zone of the register
 * @param firstDay the local day of the first cash session, or null when the register never opened one
 * @param windowDays how many past days may be captured
 * @returns the days, newest first
 */
export function captureDaysFrom(today: string, firstDay: string | null, windowDays: number = BACKDATE_WINDOW_DAYS): string[] {
  const todayMs = parseDay(today);
  const days = [today];
  if (firstDay === null) {
    return days;
  }
  const earliestMs = Math.max(todayMs - windowDays * MS_PER_DAY, parseDay(firstDay));
  for (let dayMs = todayMs - MS_PER_DAY; dayMs >= earliestMs; dayMs -= MS_PER_DAY) {
    days.push(dayText(dayMs));
  }
  return days;
}

/**
 * Reads, from the local database and the clock, which days a session may capture (E1-60, ADR 0074). The window starts at
 * the first cash session rather than the first sale, so a register that started yesterday and could not sell then can still
 * capture that day; a sale always needs a session, so it never starts later than the first sale.
 */
export class CaptureDays {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  readonly #now: () => Date;

  /**
   * @param store the open local database
   * @param tenantId the business
   * @param now the clock, so a test can move time
   */
  constructor(store: LocalStore, tenantId: string, now: () => Date = () => new Date()) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#now = now;
  }

  /** @returns today in the time zone of the register */
  today(): string {
    return localDayOf(this.#now().getTime());
  }

  /** @returns the days a session may capture, today first */
  allowed(): string[] {
    const row = this.#store
      .prepare('SELECT min(opened_at) AS first FROM cash_session WHERE tenant_id = ?')
      .get(this.#tenantId) as unknown as { first: string | null };
    return captureDaysFrom(this.today(), row.first === null ? null : localDayOf(Date.parse(row.first)));
  }
}
