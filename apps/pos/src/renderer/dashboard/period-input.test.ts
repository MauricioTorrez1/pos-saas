import { describe, expect, it } from 'vitest';

import { isDayText, movePeriod, todayInRegisterZone } from './period-input';

describe('moving between periods', () => {
  it('steps a day, a week, a month and a year', () => {
    expect(movePeriod('day', '2026-03-01', '2026-03-01', -1).date).toBe('2026-02-28');
    expect(movePeriod('week', '2026-11-10', '2026-11-10', 1).date).toBe('2026-11-17');
    expect(movePeriod('month', '2026-01-15', '2026-01-15', -1).date).toBe('2025-12-01');
    expect(movePeriod('month', '2026-12-31', '2026-12-31', 1).date).toBe('2027-01-01');
    expect(movePeriod('year', '2026-06-15', '2026-06-15', 1).date).toBe('2027-01-01');
  });

  it('moves a custom range by its own length', () => {
    expect(movePeriod('custom', '2026-11-10', '2026-11-14', 1)).toEqual({ date: '2026-11-15', endDate: '2026-11-19' });
    expect(movePeriod('custom', '2026-11-10', '2026-11-14', -1)).toEqual({ date: '2026-11-05', endDate: '2026-11-09' });
  });
});

describe('days typed in a box', () => {
  it('accepts a real day and refuses the rest', () => {
    expect(isDayText('2026-11-10')).toBe(true);
    expect(isDayText('2026-02-30')).toBe(false);
    expect(isDayText('2026-1-10')).toBe(false);
    expect(isDayText('')).toBe(false);
  });

  it('reads today in Mexico City even when it is already tomorrow in UTC', () => {
    // 2026-11-11 03:00 UTC is 21:00 of the 10th in Mexico City.
    expect(todayInRegisterZone(new Date('2026-11-11T03:00:00.000Z'))).toBe('2026-11-10');
    expect(todayInRegisterZone(new Date('2026-11-11T06:00:00.000Z'))).toBe('2026-11-11');
  });
});
