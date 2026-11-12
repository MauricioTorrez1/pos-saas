import { DASHBOARD_TIME_ZONE, type PeriodKind } from '../../shared/dashboard-api';

const MS_PER_DAY = 86_400_000;
const TODAY_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: DASHBOARD_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

/**
 * Today in the time zone of the register, which may not be the one of the computer.
 *
 * @param now the moment, for tests
 * @returns `YYYY-MM-DD`
 */
export function todayInRegisterZone(now: Date = new Date()): string {
  return TODAY_FORMAT.format(now);
}

function civil(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function text(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Moves the reference day of a period to the one before or after it, so the arrows of the screen step by a whole day, week,
 * month or year, and by the length of the range for a custom one.
 *
 * @param period the kind of period
 * @param date the reference day, or the first day of a custom range
 * @param endDate the last day of a custom range
 * @param direction -1 for the one before, 1 for the one after
 * @returns the new reference day and, for a custom range, the new last day
 */
export function movePeriod(period: PeriodKind, date: string, endDate: string, direction: -1 | 1): { date: string; endDate: string } {
  const start = civil(date);
  switch (period) {
    case 'day':
      return { date: text(new Date(start.getTime() + direction * MS_PER_DAY)), endDate };
    case 'week':
      return { date: text(new Date(start.getTime() + direction * 7 * MS_PER_DAY)), endDate };
    case 'month':
      return { date: text(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + direction, 1))), endDate };
    case 'year':
      return { date: text(new Date(Date.UTC(start.getUTCFullYear() + direction, 0, 1))), endDate };
    case 'custom': {
      const length = Math.round((civil(endDate).getTime() - start.getTime()) / MS_PER_DAY) + 1;
      return { date: text(new Date(start.getTime() + direction * length * MS_PER_DAY)), endDate: text(new Date(civil(endDate).getTime() + direction * length * MS_PER_DAY)) };
    }
  }
}

/**
 * Tells whether a day typed in a box can be asked for.
 *
 * @param value what the box holds
 * @returns true for a real day of the form `YYYY-MM-DD`
 */
export function isDayText(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = civil(value);
  return !Number.isNaN(date.getTime()) && text(date) === value && date.getUTCFullYear() >= 2000;
}
