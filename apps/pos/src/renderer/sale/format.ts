import { formatCents, type Quantity, type TaxRate, type Unit } from '@pos-saas/money';

const MILLI_PER_UNIT = 1000;
const QUANTITY_DECIMALS = 3;
const BASIS_POINTS_PER_PERCENT = 100;
const PERCENT_DECIMALS = 2;

/**
 * Shows an amount that may be negative, such as the cash a drawer should hold after more was taken out than came in.
 *
 * @param amountCents the amount in cents, which may be below zero
 * @returns text such as "$35.00" or "−$35.00"
 */
export function formatSignedCents(amountCents: number): string {
  return amountCents < 0 ? `−${formatCents(-amountCents)}` : formatCents(amountCents);
}

const MOMENT_FORMAT = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' });

const UNIT_LABELS: Readonly<Record<Unit, string>> = {
  piece: 'pza',
  meter: 'm',
  kilogram: 'kg',
  liter: 'L',
};

/**
 * Names a unit as it appears next to a price.
 *
 * @param unit the unit
 * @returns its short name, such as "pza" or "m"
 */
export function unitLabel(unit: Unit): string {
  return UNIT_LABELS[unit];
}

/**
 * Shows a quantity with its unit: whole for pieces, and with three decimals for what is measured.
 *
 * @param quantity the quantity
 * @returns text such as "3 pza" or "3.275 m"
 */
export function formatQuantity({ milli, unit }: Quantity): string {
  const thousandths = milli % MILLI_PER_UNIT;
  const whole = (milli - thousandths) / MILLI_PER_UNIT;
  const number = unit === 'piece' ? String(whole) : `${whole}.${String(thousandths).padStart(QUANTITY_DECIMALS, '0')}`;
  return `${number} ${UNIT_LABELS[unit]}`;
}

/**
 * Shows when a sale happened, in the time zone of the register.
 *
 * @param isoMoment the moment in ISO 8601
 * @returns text such as "8 nov 2026, 2:05 p.m."
 */
export function formatSaleMoment(isoMoment: string): string {
  return MOMENT_FORMAT.format(new Date(isoMoment));
}

/**
 * Names a tax rate as it appears in the totals.
 *
 * @param taxRate the rate
 * @returns "IVA 16%", "IVA 10.5%", or "Exento"
 */
export function formatTaxLabel({ factor, rateBp }: TaxRate): string {
  if (factor === 'exempt') {
    return 'Exento';
  }
  const remainder = rateBp % BASIS_POINTS_PER_PERCENT;
  const percent = (rateBp - remainder) / BASIS_POINTS_PER_PERCENT;
  const decimals = remainder === 0 ? '' : `.${String(remainder).padStart(PERCENT_DECIMALS, '0').replace(/0$/, '')}`;
  return `IVA ${percent}${decimals}%`;
}
