import { formatCents, type Unit } from '@pos-saas/money';

import type { PaymentKind, PeriodRange, TopMetric } from './dashboard-api';

const MILLI_PER_UNIT = 1000;

const UNIT_LABELS: Readonly<Record<Unit, string>> = { piece: 'pza', meter: 'm', kilogram: 'kg', liter: 'L' };

/** The names of the ways to pay, as the owner reads them. */
export const PAYMENT_KIND_LABELS: Readonly<Record<PaymentKind, string>> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  mixed: 'Mixto',
};

/** The names of the days of the week, Monday first. */
export const WEEKDAY_LABELS: readonly string[] = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export const TOP_METRIC_LABELS: Readonly<Record<TopMetric, string>> = {
  quantity: 'Por cantidad',
  amount: 'Por importe',
  profit: 'Por utilidad',
};

const DAY_FORMAT = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeZone: 'UTC' });
const MONTH_FORMAT = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function civil(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

/**
 * Shows money that may be negative, which `formatCents` does not accept.
 *
 * @param cents an integer of cents
 * @returns text such as "$1,250.00" or "−$35.00"
 */
export function pesosLabel(cents: number): string {
  return cents < 0 ? `−${formatCents(-cents)}` : formatCents(cents);
}

/**
 * Writes an integer of hundredths as decimal text without a float, such as 123456 as "1234.56".
 *
 * @param hundredths an integer, which may be negative
 * @returns the exact decimal text
 */
function hundredthsText(hundredths: number): string {
  const sign = hundredths < 0 ? '-' : '';
  const magnitude = Math.abs(hundredths);
  const rest = magnitude % 100;
  return `${sign}${(magnitude - rest) / 100}.${String(rest).padStart(2, '0')}`;
}

/**
 * Cents as the exact decimal pesos, for a spreadsheet cell.
 *
 * @param cents an integer, which may be negative
 * @returns text such as "1234.50"
 */
export function pesosText(cents: number): string {
  return hundredthsText(cents);
}

/**
 * Basis points as the exact decimal percent, for a spreadsheet cell.
 *
 * @param basisPoints an integer, which may be negative
 * @returns text such as "25.34"
 */
export function percentText(basisPoints: number): string {
  return hundredthsText(basisPoints);
}

/**
 * Thousandths of a unit as the exact decimal quantity.
 *
 * @param milli an integer, which may be negative
 * @returns text with three decimals, such as "3.275"
 */
export function quantityNumberText(milli: number): string {
  const sign = milli < 0 ? '-' : '';
  const magnitude = Math.abs(milli);
  const rest = magnitude % MILLI_PER_UNIT;
  return `${sign}${(magnitude - rest) / MILLI_PER_UNIT}.${String(rest).padStart(3, '0')}`;
}

/**
 * A cost in millionths of a peso as the exact decimal pesos.
 *
 * @param costE6 an integer of millionths of a peso
 * @returns text with six decimals, such as "5.000000"
 */
export function costNumberText(costE6: number): string {
  const rest = costE6 % 1_000_000;
  return `${(costE6 - rest) / 1_000_000}.${String(rest).padStart(6, '0')}`;
}

/**
 * Shows a quantity with its unit: whole for pieces and with three decimals for what is measured.
 *
 * @param milli thousandths of the unit
 * @param unit the unit
 * @returns text such as "3 pza" or "3.275 m"
 */
export function quantityText(milli: number, unit: Unit): string {
  const sign = milli < 0 ? '−' : '';
  const magnitude = Math.abs(milli);
  const rest = magnitude % MILLI_PER_UNIT;
  const whole = (magnitude - rest) / MILLI_PER_UNIT;
  return `${sign}${unit === 'piece' ? String(whole) : `${whole}.${String(rest).padStart(3, '0')}`} ${UNIT_LABELS[unit]}`;
}

/**
 * Shows a cost per unit, from two decimals up to the six it is kept with, without trailing zeros past the cents.
 *
 * @param costE6 millionths of a peso
 * @returns text such as "$60.00", "$6.50" or "$0.0125"
 */
export function costLabel(costE6: number): string {
  const [pesos, decimals] = costNumberText(costE6).split('.') as [string, string];
  const trimmed = decimals.replace(/0+$/, '').padEnd(2, '0');
  return `$${pesos.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${trimmed}`;
}

/**
 * Shows basis points as a percent.
 *
 * @param basisPoints an integer, which may be negative
 * @returns text such as "25.34 %"
 */
export function percentLabel(basisPoints: number): string {
  return `${percentText(basisPoints)} %`;
}

/**
 * Shows lines per ticket.
 *
 * @param hundredths lines per ticket times 100
 * @returns text such as "2.50"
 */
export function hundredthsLabel(hundredths: number): string {
  return hundredthsText(hundredths);
}

/**
 * Names a period for a title: one day, or the first and last day.
 *
 * @param range the period
 * @returns text such as "10 nov 2026" or "9 nov 2026 al 15 nov 2026"
 */
export function periodLabel(range: PeriodRange): string {
  if (range.kind === 'month') {
    return MONTH_FORMAT.format(civil(range.fromDay));
  }
  if (range.kind === 'year') {
    return range.fromDay.slice(0, 4);
  }
  if (range.fromDay === range.toDay) {
    return DAY_FORMAT.format(civil(range.fromDay));
  }
  return `${DAY_FORMAT.format(civil(range.fromDay))} al ${DAY_FORMAT.format(civil(range.toDay))}`;
}

/**
 * Names a bucket of the trend chart.
 *
 * @param key `YYYY-MM-DD` or `YYYY-MM`
 * @returns a short label such as "10 nov" or "nov 2026"
 */
export function trendLabel(key: string): string {
  if (key.length === 7) {
    return new Intl.DateTimeFormat('es-MX', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(civil(`${key}-01`));
  }
  return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(civil(key));
}

/**
 * Compares a number with the one of the period before.
 *
 * @param current this period
 * @param previous the period before
 * @returns the change as text such as "+12.5 %" or "−3.0 %", "sin cambio", or "nuevo" when there was nothing before
 */
export function changeLabel(current: number, previous: number): string {
  if (previous === 0) {
    return current === 0 ? 'sin cambio' : 'nuevo';
  }
  const tenths = Number((BigInt(Math.abs(current - previous)) * 2000n + BigInt(Math.abs(previous))) / (BigInt(Math.abs(previous)) * 2n));
  if (tenths === 0) {
    return 'sin cambio';
  }
  const direction = current > previous ? '+' : '−';
  return `${direction}${Math.floor(tenths / 10)}.${tenths % 10} %`;
}
