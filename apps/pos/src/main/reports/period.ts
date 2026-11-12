import { DASHBOARD_TIME_ZONE, MAX_CUSTOM_DAYS, type PeriodKind, type PeriodRange } from '../../shared/dashboard-api';

const DAY_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

const ZONE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: DASHBOARD_TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
});

/** A period with the moments, in UTC, that bound it. The end is not included. */
export interface ResolvedPeriod extends PeriodRange {
  readonly fromMs: number;
  readonly toMs: number;
}

/** A stretch of time during which the time zone keeps one offset from UTC. */
export interface OffsetSegment {
  readonly fromMs: number;
  readonly toMs: number;
  /** Minutes to add to UTC to get the local time, such as -360. */
  readonly offsetMinutes: number;
}

/**
 * Reads a day typed as `YYYY-MM-DD` and checks it exists.
 *
 * @param text the day
 * @returns the civil date as milliseconds of that day at 00:00 UTC, which is only a way to do calendar arithmetic
 * @throws RangeError if the text is not a real day
 */
export function parseDay(text: string): number {
  const match = DAY_TEXT.exec(text);
  if (match === null) {
    throw new RangeError('Expected a day as YYYY-MM-DD');
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const value = new Date(Date.UTC(year, month - 1, day));
  if (value.getUTCFullYear() !== year || value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day || year < 2000) {
    throw new RangeError('That day does not exist');
  }
  return value.getTime();
}

/**
 * Writes a civil date as text.
 *
 * @param civilMs a civil date as milliseconds at 00:00 UTC
 * @returns `YYYY-MM-DD`
 */
export function dayText(civilMs: number): string {
  return new Date(civilMs).toISOString().slice(0, 10);
}

/**
 * How far the register's time zone is from UTC at a moment. It follows the rules of the zone, so a day with a change of
 * clock gets the right offset on each side of the change.
 *
 * @param utcMs the moment
 * @returns minutes to add to UTC to get the local time
 */
export function offsetMinutesAt(utcMs: number): number {
  const parts = Object.fromEntries(ZONE_PARTS.formatToParts(new Date(utcMs)).map((part) => [part.type, Number(part.value)]));
  const asIfUtc = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  return Math.round((asIfUtc - Math.floor(utcMs / 1000) * 1000) / MS_PER_MINUTE);
}

/**
 * The moment, in UTC, where a local day starts. A change of clock never falls at midnight in Mexico, but the offset is
 * resolved twice anyway so a zone that does it would still land on a real midnight.
 *
 * @param civilMs a civil date as milliseconds at 00:00 UTC
 * @returns the UTC moment of 00:00 local that day
 */
export function startOfLocalDay(civilMs: number): number {
  const first = civilMs - offsetMinutesAt(civilMs) * MS_PER_MINUTE;
  return civilMs - offsetMinutesAt(first) * MS_PER_MINUTE;
}

function addDays(civilMs: number, days: number): number {
  return civilMs + days * MS_PER_DAY;
}

function monthStart(civilMs: number): number {
  const date = new Date(civilMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function addMonths(civilMs: number, months: number): number {
  const date = new Date(civilMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1);
}

function weekStart(civilMs: number): number {
  const sundayFirst = new Date(civilMs).getUTCDay();
  return addDays(civilMs, -((sundayFirst + 6) % 7));
}

function range(kind: PeriodKind, firstCivil: number, lastCivil: number): ResolvedPeriod {
  return {
    kind,
    fromDay: dayText(firstCivil),
    toDay: dayText(lastCivil),
    dayCount: Math.round((lastCivil - firstCivil) / MS_PER_DAY) + 1,
    fromMs: startOfLocalDay(firstCivil),
    toMs: startOfLocalDay(addDays(lastCivil, 1)),
  };
}

/**
 * Turns what the screen chose into whole days of the register's time zone. A week goes from Monday to Sunday, a month and
 * a year are the calendar ones, and a custom range includes both of its days.
 *
 * @param kind day, week, month, year or custom
 * @param date a day inside the period as `YYYY-MM-DD`; for a custom range, its first day
 * @param endDate for a custom range, its last day
 * @returns the period
 * @throws RangeError if a day does not exist, a range is backwards, or a range is longer than the limit
 */
export function resolvePeriod(kind: PeriodKind, date: string, endDate?: string): ResolvedPeriod {
  const civil = parseDay(date);
  switch (kind) {
    case 'day':
      return range(kind, civil, civil);
    case 'week': {
      const first = weekStart(civil);
      return range(kind, first, addDays(first, 6));
    }
    case 'month': {
      const first = monthStart(civil);
      return range(kind, first, addDays(addMonths(first, 1), -1));
    }
    case 'year': {
      const first = Date.UTC(new Date(civil).getUTCFullYear(), 0, 1);
      return range(kind, first, Date.UTC(new Date(civil).getUTCFullYear(), 11, 31));
    }
    case 'custom': {
      const last = parseDay(endDate ?? date);
      if (last < civil) {
        throw new RangeError('The range ends before it starts');
      }
      if ((last - civil) / MS_PER_DAY + 1 > MAX_CUSTOM_DAYS) {
        throw new RangeError('The range is too long');
      }
      return range(kind, civil, last);
    }
  }
}

/**
 * The period right before another one: the day before, the week before, the month before, the year before, or for a
 * custom range the same number of days that end the day before it starts.
 *
 * @param period the period
 * @returns the previous one
 */
export function previousPeriod(period: ResolvedPeriod): ResolvedPeriod {
  const first = parseDay(period.fromDay);
  switch (period.kind) {
    case 'day':
    case 'week':
    case 'month':
    case 'year': {
      const reference = { day: addDays(first, -1), week: addDays(first, -7), month: addDays(first, -1), year: addDays(first, -1) }[period.kind];
      return resolvePeriod(period.kind, dayText(reference));
    }
    default:
      return range('custom', addDays(first, -period.dayCount), addDays(first, -1));
  }
}

/**
 * Splits a stretch of time where the offset of the zone is the same, so a query can shift the stored UTC moments by a
 * constant to read local days and hours. In a zone without changes of clock it is a single segment.
 *
 * @param fromMs start, included
 * @param toMs end, not included
 * @returns the segments, in order, that cover the stretch
 */
export function offsetSegments(fromMs: number, toMs: number): OffsetSegment[] {
  const segments: OffsetSegment[] = [];
  let segmentStart = fromMs;
  let offset = offsetMinutesAt(fromMs);
  for (let probe = fromMs; probe < toMs; probe += MS_PER_DAY) {
    const next = Math.min(probe + MS_PER_DAY, toMs);
    const sample = next === toMs ? toMs - 1 : next;
    const nextOffset = offsetMinutesAt(sample);
    if (nextOffset === offset) {
      continue;
    }
    // The change is somewhere in (probe, sample]: find the first millisecond with the new offset.
    let low = probe;
    let high = sample;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (offsetMinutesAt(middle) === offset) {
        low = middle;
      } else {
        high = middle;
      }
    }
    segments.push({ fromMs: segmentStart, toMs: high, offsetMinutes: offset });
    segmentStart = high;
    offset = nextOffset;
  }
  segments.push({ fromMs: segmentStart, toMs, offsetMinutes: offset });
  return segments;
}

/**
 * Tells which local day a moment falls in.
 *
 * @param utcMs the moment
 * @returns `YYYY-MM-DD` in the time zone of the register
 */
export function localDayOf(utcMs: number): string {
  return dayText(Math.floor((utcMs + offsetMinutesAt(utcMs) * MS_PER_MINUTE) / MS_PER_DAY) * MS_PER_DAY);
}

/**
 * Counts the days from one day to another, both included.
 *
 * @param fromDay `YYYY-MM-DD`
 * @param toDay `YYYY-MM-DD`, not before `fromDay`
 * @returns how many days
 */
export function dayCountBetween(fromDay: string, toDay: string): number {
  return Math.round((parseDay(toDay) - parseDay(fromDay)) / MS_PER_DAY) + 1;
}

/**
 * Names the civil days of a period.
 *
 * @param period the period
 * @returns every day as `YYYY-MM-DD`, in order
 */
export function daysOf(period: PeriodRange): string[] {
  const days: string[] = [];
  const first = parseDay(period.fromDay);
  for (let index = 0; index < period.dayCount; index += 1) {
    days.push(dayText(addDays(first, index)));
  }
  return days;
}

/**
 * Names the calendar months a period touches.
 *
 * @param period the period
 * @returns every month as `YYYY-MM`, in order
 */
export function monthsOf(period: PeriodRange): string[] {
  const months: string[] = [];
  const last = parseDay(period.toDay);
  for (let month = monthStart(parseDay(period.fromDay)); month <= last; month = addMonths(month, 1)) {
    months.push(dayText(month).slice(0, 7));
  }
  return months;
}

/**
 * Tells the weekday of a civil day.
 *
 * @param day `YYYY-MM-DD`
 * @returns 0 for Monday up to 6 for Sunday
 */
export function weekdayOf(day: string): number {
  return (new Date(parseDay(day)).getUTCDay() + 6) % 7;
}
