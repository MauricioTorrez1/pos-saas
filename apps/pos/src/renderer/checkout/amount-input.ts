import { formatCents, MoneyError, parseCents } from '@pos-saas/money';

import type { PaymentPlan } from '../../shared/payment-plan';

/** What the cashier sees about a payment that is being typed. */
export interface PlanDescription {
  /** `ready` can be recorded, `short` still needs money, and `problem` needs a correction. */
  readonly tone: 'ready' | 'short' | 'problem';
  readonly text: string;
}

/**
 * Reads an amount typed at the counter. The cashier may type the peso sign or commas, and the money library does not
 * accept them, so they are removed first.
 *
 * @param text what was typed, such as "50", "$1,250.50", or nothing at all
 * @returns the amount in cents, 0 for an empty box, or null if the text is not an amount
 */
export function readTypedCents(text: string): number | null {
  const cleaned = text.replace(/[\s$,]/g, '');
  if (cleaned === '') {
    return 0;
  }
  try {
    return parseCents(cleaned);
  } catch (error) {
    if (error instanceof MoneyError) {
      return null;
    }
    throw error;
  }
}

/**
 * Words what a payment plan means for the cashier.
 *
 * @param plan the result of matching what was handed over against the total
 * @returns the text to show, and whether it is good news, a missing amount, or something to fix
 */
export function describePlan(plan: PaymentPlan): PlanDescription {
  switch (plan.status) {
    case 'ready':
      return { tone: 'ready', text: plan.changeCents === 0 ? 'Pago exacto' : `Cambio ${formatCents(plan.changeCents)}` };
    case 'short':
      return { tone: 'short', text: `Faltan ${formatCents(plan.missingCents)}` };
    case 'transfers_exceed_total':
      return { tone: 'problem', text: `La transferencia y la tarjeta pasan el total por ${formatCents(plan.excessCents)}. No dan cambio.` };
    case 'cash_not_needed':
      return { tone: 'problem', text: 'Las transferencias ya cubren el total. Quita el efectivo.' };
    case 'reference_missing':
      return { tone: 'problem', text: 'Escribe la referencia de la transferencia.' };
    case 'folio_missing':
      return { tone: 'problem', text: 'Escribe el folio que dio la terminal de tarjeta.' };
    case 'card_number_entered':
      return { tone: 'problem', text: 'Eso parece un número de tarjeta, y la caja nunca lo guarda. Escribe solo el folio de la terminal.' };
  }
}
