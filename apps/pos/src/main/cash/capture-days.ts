import { BACKDATE_WINDOW_DAYS, type PastCaptureDay } from '../../shared/capture-day';
import type { LocalStore } from '../local-store/local-store';
import { dayText, localDayOf, parseDay } from '../reports/period';
import { CashSessionStore } from './cash-session-store';

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
 * Reads, from the local database and the clock, which days a session may capture (E1-60, ADR 0076). The window starts at
 * the first cash session rather than the first sale, so a register that started yesterday and could not sell then can still
 * capture that day; a sale always needs a session, so it never starts later than the first sale. A day whose session was
 * left without its cut is always offered, even past the window, because that session still needs its cut (E1-61, ADR 0078).
 */
export class CaptureDays {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  readonly #now: () => Date;
  readonly #sessions: CashSessionStore;

  /**
   * @param store the open local database
   * @param tenantId the business
   * @param now the clock, so a test can move time
   */
  constructor(store: LocalStore, tenantId: string, now: () => Date = () => new Date()) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#now = now;
    this.#sessions = new CashSessionStore(store, tenantId, now);
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
    const today = this.today();
    const days = captureDaysFrom(today, row.first === null ? null : localDayOf(Date.parse(row.first)));
    const unfinished = this.#sessions.listOpen().map(({ sessionDay }) => sessionDay);
    const older = [...new Set(unfinished)].filter((day) => day < today && !days.includes(day));
    return [...days, ...older.sort().reverse()];
  }

  /**
   * Tells how each past day the sign-in offers stands: the session it left without a cut, which choosing it resumes, and
   * how many cuts it already has, so a cut day asks before adding a supplementary capture (E1-61).
   *
   * @returns the past days, newest first, in the order `allowed` gives them
   */
  pastDays(): PastCaptureDay[] {
    const past = this.allowed().slice(1);
    const oldest = past.at(-1);
    if (oldest === undefined) {
      return [];
    }
    const cuts = this.#sessions.cutsByDaySince(oldest);
    const open = this.#sessions.listOpen();
    return past.map((day) => {
      const session = open.find(({ sessionDay }) => sessionDay === day);
      return {
        day,
        unfinished:
          session === undefined
            ? null
            : { sessionId: session.id, openedBy: session.openedByName, openedAt: session.openedAt, openingFloatCents: session.openingFloatCents },
        cutCount: cuts.get(day)?.length ?? 0,
      };
    });
  }
}
