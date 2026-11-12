import { describe, expect, it } from 'vitest';

import { dayCountBetween, localDayOf, monthsOf, offsetMinutesAt, offsetSegments, parseDay, previousPeriod, resolvePeriod, startOfLocalDay, weekdayOf } from './period';

const MINUTE = 60_000;

describe('the periods of the dashboard', () => {
  it('counts a week from Monday to Sunday', () => {
    // 2026-11-10 is a Tuesday, and 2026-11-15 a Sunday.
    expect(resolvePeriod('week', '2026-11-10')).toMatchObject({ fromDay: '2026-11-09', toDay: '2026-11-15', dayCount: 7 });
    expect(resolvePeriod('week', '2026-11-15')).toMatchObject({ fromDay: '2026-11-09', toDay: '2026-11-15' });
    expect(resolvePeriod('week', '2026-11-16')).toMatchObject({ fromDay: '2026-11-16', toDay: '2026-11-22' });
  });

  it('counts calendar months and years, including February of a leap year', () => {
    expect(resolvePeriod('month', '2028-02-10')).toMatchObject({ fromDay: '2028-02-01', toDay: '2028-02-29', dayCount: 29 });
    expect(resolvePeriod('month', '2026-12-31')).toMatchObject({ fromDay: '2026-12-01', toDay: '2026-12-31' });
    expect(resolvePeriod('year', '2026-06-15')).toMatchObject({ fromDay: '2026-01-01', toDay: '2026-12-31', dayCount: 365 });
  });

  it('starts and ends the days at midnight of Mexico City, which is six hours after UTC outside daylight time', () => {
    const period = resolvePeriod('day', '2026-11-10');

    expect(new Date(period.fromMs).toISOString()).toBe('2026-11-10T06:00:00.000Z');
    expect(new Date(period.toMs).toISOString()).toBe('2026-11-11T06:00:00.000Z');
  });

  it('keeps a day with a change of clock at 23 or 25 hours', () => {
    // Daylight time began on 2022-04-03 and ended on 2022-10-30, the last years Mexico changed its clocks.
    const spring = resolvePeriod('day', '2022-04-03');
    const fall = resolvePeriod('day', '2022-10-30');

    expect((spring.toMs - spring.fromMs) / (60 * MINUTE)).toBe(23);
    expect((fall.toMs - fall.fromMs) / (60 * MINUTE)).toBe(25);
    expect(new Date(spring.fromMs).toISOString()).toBe('2022-04-03T06:00:00.000Z');
    expect(new Date(fall.fromMs).toISOString()).toBe('2022-10-30T05:00:00.000Z');
  });

  it('finds the previous period of each kind', () => {
    expect(previousPeriod(resolvePeriod('day', '2026-03-01'))).toMatchObject({ fromDay: '2026-02-28', toDay: '2026-02-28' });
    expect(previousPeriod(resolvePeriod('week', '2026-11-10'))).toMatchObject({ fromDay: '2026-11-02', toDay: '2026-11-08' });
    expect(previousPeriod(resolvePeriod('month', '2026-03-10'))).toMatchObject({ fromDay: '2026-02-01', toDay: '2026-02-28' });
    expect(previousPeriod(resolvePeriod('year', '2026-03-10'))).toMatchObject({ fromDay: '2025-01-01', toDay: '2025-12-31' });
    expect(previousPeriod(resolvePeriod('custom', '2026-11-10', '2026-11-14'))).toMatchObject({ fromDay: '2026-11-05', toDay: '2026-11-09', dayCount: 5 });
  });

  it('refuses days that do not exist, ranges that run backwards, and ranges that are too long', () => {
    expect(() => resolvePeriod('day', '2026-02-30')).toThrow(RangeError);
    expect(() => resolvePeriod('day', 'ayer')).toThrow(RangeError);
    expect(() => resolvePeriod('custom', '2026-11-10', '2026-11-09')).toThrow(/ends before/);
    expect(() => resolvePeriod('custom', '2020-01-01', '2026-11-09')).toThrow(/too long/);
  });

  it('splits a stretch at the change of clock so each part has one offset', () => {
    const october = resolvePeriod('month', '2022-10-15');
    const segments = offsetSegments(october.fromMs, october.toMs);

    expect(segments.map((segment) => segment.offsetMinutes)).toEqual([-300, -360]);
    // The change is at 02:00 daylight time, which is 07:00 UTC.
    expect(new Date(segments[0]!.toMs).toISOString()).toBe('2022-10-30T07:00:00.000Z');
    expect(segments[1]!.fromMs).toBe(segments[0]!.toMs);
    expect(segments[1]!.toMs).toBe(october.toMs);
    expect(offsetSegments(resolvePeriod('year', '2026-01-01').fromMs, resolvePeriod('year', '2026-01-01').toMs)).toHaveLength(1);
  });

  it('works with civil days', () => {
    expect(dayCountBetween('2026-11-10', '2026-11-12')).toBe(3);
    expect(monthsOf(resolvePeriod('custom', '2026-10-15', '2027-01-02'))).toEqual(['2026-10', '2026-11', '2026-12', '2027-01']);
    expect(weekdayOf('2026-11-09')).toBe(0);
    expect(weekdayOf('2026-11-15')).toBe(6);
    expect(localDayOf(Date.parse('2026-11-11T05:59:59.999Z'))).toBe('2026-11-10');
    expect(localDayOf(Date.parse('2026-11-11T06:00:00.000Z'))).toBe('2026-11-11');
    expect(offsetMinutesAt(parseDay('2026-07-01'))).toBe(-360);
    expect(startOfLocalDay(parseDay('2026-11-10'))).toBe(Date.parse('2026-11-10T06:00:00.000Z'));
  });
});
