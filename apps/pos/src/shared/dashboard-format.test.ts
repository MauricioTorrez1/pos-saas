import { describe, expect, it } from 'vitest';

import { changeLabel, costLabel, costNumberText, percentText, periodLabel, pesosLabel, pesosText, quantityNumberText, quantityText, trendLabel } from './dashboard-format';

describe('the words and numbers of the dashboard', () => {
  it('writes cents as exact decimal pesos, negative too', () => {
    expect(pesosText(123_456)).toBe('1234.56');
    expect(pesosText(5)).toBe('0.05');
    expect(pesosText(-1_050)).toBe('-10.50');
    expect(pesosLabel(-3_500)).toBe('−$35.00');
    expect(pesosLabel(123_456_789)).toBe('$1,234,567.89');
  });

  it('writes basis points, quantities and costs without a float', () => {
    expect(percentText(4_143)).toBe('41.43');
    expect(percentText(-250)).toBe('-2.50');
    expect(quantityNumberText(3_275)).toBe('3.275');
    expect(quantityNumberText(-500)).toBe('-0.500');
    expect(costNumberText(5_000_000)).toBe('5.000000');
    expect(costNumberText(12_500)).toBe('0.012500');
  });

  it('shows a quantity whole for pieces and with three decimals for what is measured', () => {
    expect(quantityText(3_000, 'piece')).toBe('3 pza');
    expect(quantityText(3_275, 'meter')).toBe('3.275 m');
    expect(quantityText(1_500, 'kilogram')).toBe('1.500 kg');
    expect(quantityText(250, 'liter')).toBe('0.250 L');
    expect(quantityText(-2_000, 'piece')).toBe('−2 pza');
  });

  it('shows a cost with at least two decimals and as many as it really has', () => {
    expect(costLabel(60_000_000)).toBe('$60.00');
    expect(costLabel(6_500_000)).toBe('$6.50');
    expect(costLabel(12_500)).toBe('$0.0125');
    expect(costLabel(1_234_567_000_000)).toBe('$1,234,567.00');
  });

  it('compares with the period before', () => {
    expect(changeLabel(150, 100)).toBe('+50.0 %');
    expect(changeLabel(75, 100)).toBe('−25.0 %');
    expect(changeLabel(100, 100)).toBe('sin cambio');
    expect(changeLabel(5, 0)).toBe('nuevo');
    expect(changeLabel(0, 0)).toBe('sin cambio');
    // Less than a tenth of a percent is no change.
    expect(changeLabel(10_001, 10_000)).toBe('sin cambio');
    expect(changeLabel(1, 3)).toBe('−66.7 %');
    // The change is of the number: from −100 to −50 it went up by half of 100.
    expect(changeLabel(-50, -100)).toBe('+50.0 %');
  });

  it('names periods and buckets in Spanish', () => {
    expect(periodLabel({ kind: 'day', fromDay: '2026-11-10', toDay: '2026-11-10', dayCount: 1 })).toBe('10 nov 2026');
    expect(periodLabel({ kind: 'week', fromDay: '2026-11-09', toDay: '2026-11-15', dayCount: 7 })).toBe('9 nov 2026 al 15 nov 2026');
    expect(periodLabel({ kind: 'month', fromDay: '2026-11-01', toDay: '2026-11-30', dayCount: 30 })).toBe('noviembre de 2026');
    expect(periodLabel({ kind: 'year', fromDay: '2026-01-01', toDay: '2026-12-31', dayCount: 365 })).toBe('2026');
    expect(trendLabel('2026-11-10')).toBe('10 nov');
    expect(trendLabel('2026-11')).toBe('nov 2026');
  });
});
