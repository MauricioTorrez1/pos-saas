import { MoneyError, parseUnitPriceE4 } from '@pos-saas/money';

import { MAX_UNIT_PRICE_E4 } from '../../shared/pricing';

const TOO_HIGH = 'El precio es demasiado alto: el máximo es $1,000,000.00. Revisa que no sobre un cero.';

/** What reading the price the person typed gave: the price, or what to tell them. */
export type PriceReading = { readonly ok: true; readonly unitPriceE4: number } | { readonly ok: false; readonly message: string };

/**
 * Reads a price typed by a person, in pesos with VAT included, with the same rules as the unit prices of the catalog:
 * digits and one point, up to 4 decimals (ADR 0011). A price of zero is refused because a free product is almost always a
 * typing mistake (ADR 0047).
 *
 * @param text what was typed, such as "135.50"
 * @returns the price in ten-thousandths of a peso, or a message in Spanish that says what to fix
 */
export function readNewPrice(text: string): PriceReading {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { ok: false, message: 'Escribe el precio nuevo.' };
  }
  let unitPriceE4: number;
  try {
    unitPriceE4 = parseUnitPriceE4(trimmed);
  } catch (error) {
    if (error instanceof MoneyError && error.code === 'too_many_decimals') {
      return { ok: false, message: 'El precio admite hasta 4 decimales.' };
    }
    if (error instanceof MoneyError && error.code === 'overflow') {
      return { ok: false, message: TOO_HIGH };
    }
    return { ok: false, message: 'Revisa el precio: solo números y un punto decimal, sin signo de pesos ni comas.' };
  }
  if (unitPriceE4 === 0) {
    return { ok: false, message: 'El precio debe ser mayor que cero.' };
  }
  if (unitPriceE4 > MAX_UNIT_PRICE_E4) {
    return { ok: false, message: TOO_HIGH };
  }
  return { ok: true, unitPriceE4 };
}

const PERCENT = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/**
 * Shows basis points as a percentage for a person: 3,333 is "33.3 %".
 *
 * @param basisPoints hundredths of a percent, possibly negative
 * @returns the percentage with one decimal
 */
export function formatBasisPoints(basisPoints: number): string {
  return `${PERCENT.format(basisPoints / 100)} %`;
}
