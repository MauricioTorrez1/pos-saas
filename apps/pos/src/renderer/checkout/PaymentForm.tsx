import { formatCents } from '@pos-saas/money';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';

import { planPayments, type PaymentPlan, type PaymentTender } from '../../shared/payment-plan';
import { describePlan, readTypedCents } from './amount-input';

const INVALID_AMOUNT = 'Escribe solo números, por ejemplo 50 o 50.00.';

/** What the form asks for, as the bridge expects it. */
export type EnteredPayment = PaymentTender;

interface PaymentFormProps {
  readonly totalCents: number;
  /** While true the keys do nothing, because the payment is being recorded. */
  readonly isBusy: boolean;
  /** Called with F2 when the payment can be recorded. */
  readonly onSubmit: (payment: EnteredPayment) => void;
  /** Called with Esc. */
  readonly onBack: () => void;
  readonly submitLabel: string;
  readonly backLabel: string;
}

function toPlan(totalCents: number, cashText: string, transferText: string, reference: string): PaymentPlan | 'invalid' {
  const cashReceivedCents = readTypedCents(cashText);
  const transferCents = readTypedCents(transferText);
  if (cashReceivedCents === null || transferCents === null) {
    return 'invalid';
  }
  return planPayments(totalCents, {
    cashReceivedCents,
    transfers: transferCents === 0 ? [] : [{ amountCents: transferCents, reference }],
  });
}

/**
 * Where the cashier says how a sale was paid: cash received, and a transfer with its reference (RF-014, RF-015). Only
 * function keys finish or cancel it, because the Enter at the end of a barcode scan must never charge a sale. Enter moves
 * to the next box.
 *
 * @param props.totalCents what the sale costs
 * @param props.isBusy whether the payment is being recorded
 * @param props.onSubmit receives what was entered once F2 is pressed on a payment that adds up
 * @param props.onBack called with Esc
 * @param props.submitLabel the action of F2, such as "Cobrar"
 * @param props.backLabel the action of Esc
 * @returns the form
 */
export function PaymentForm({ totalCents, isBusy, onSubmit, onBack, submitLabel, backLabel }: PaymentFormProps): ReactElement {
  const [cashText, setCashText] = useState('');
  const [transferText, setTransferText] = useState('');
  const [reference, setReference] = useState('');
  const cashRef = useRef<HTMLInputElement>(null);
  const transferRef = useRef<HTMLInputElement>(null);
  const referenceRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    cashRef.current?.focus();
  }, []);

  const plan = toPlan(totalCents, cashText, transferText, reference);
  const description = plan === 'invalid' ? { tone: 'problem' as const, text: INVALID_AMOUNT } : describePlan(plan);

  const submit = (): void => {
    if (plan !== 'invalid' && plan.status === 'ready') {
      onSubmit({
        cashReceivedCents: readTypedCents(cashText) ?? 0,
        transfers: plan.payments.flatMap((payment) =>
          payment.method === 'transfer' ? [{ amountCents: payment.amountCents, reference: payment.reference }] : [],
        ),
      });
    }
  };

  // The cash and the transfer cannot both be asked to cover the same peso, so each shortcut fills what the other leaves.
  const fillCash = (): void => {
    const transferCents = readTypedCents(transferText) ?? 0;
    setCashText(centsToText(Math.max(totalCents - transferCents, 0)));
    cashRef.current?.focus();
  };
  const fillTransfer = (): void => {
    const cashCents = readTypedCents(cashText) ?? 0;
    setTransferText(centsToText(Math.max(totalCents - cashCents, 0)));
    referenceRef.current?.focus();
  };

  // On the window, because a click on the backdrop leaves the keyboard outside the form. It runs after every render so
  // the keys always act on what is on the screen.
  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      const actions: Readonly<Record<string, (() => void) | undefined>> = { F2: submit, F5: fillCash, F6: fillTransfer, Escape: onBack };
      const action = actions[event.key];
      if (action === undefined) {
        return;
      }
      event.preventDefault();
      if (!isBusy) {
        action();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const moveOnEnter = (next: HTMLInputElement | null) => (event: KeyboardEvent): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      next?.focus();
    }
  };

  return (
    <div className="payment-form">
      <label className="payment-field">
        <span>Efectivo recibido</span>
        <input
          ref={cashRef}
          aria-label="Efectivo recibido"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={cashText}
          onChange={(event) => setCashText(event.target.value)}
          onKeyDown={moveOnEnter(transferRef.current)}
        />
        <kbd>F5</kbd>
        <small>Efectivo exacto</small>
      </label>
      <label className="payment-field">
        <span>Transferencia</span>
        <input
          ref={transferRef}
          aria-label="Transferencia"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={transferText}
          onChange={(event) => setTransferText(event.target.value)}
          onKeyDown={moveOnEnter(referenceRef.current)}
        />
        <kbd>F6</kbd>
        <small>Todo por transferencia</small>
      </label>
      <label className="payment-field">
        <span>Referencia de la transferencia</span>
        <input
          ref={referenceRef}
          aria-label="Referencia de la transferencia"
          type="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={60}
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          onKeyDown={moveOnEnter(null)}
        />
      </label>
      <p className="payment-status" role="status" aria-label="Estado del cobro" data-tone={description.tone}>
        {description.text}
      </p>
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={onBack} disabled={isBusy}>
          {backLabel} <kbd>Esc</kbd>
        </button>
        <button
          type="button"
          className="button button-primary"
          tabIndex={-1}
          onClick={submit}
          disabled={isBusy || description.tone !== 'ready'}
        >
          {submitLabel} <kbd>F2</kbd>
        </button>
      </div>
    </div>
  );
}

/** A box that shows an amount the way a person types it: "50" or "40.94". */
function centsToText(cents: number): string {
  return formatCents(cents).replace(/[$,]/g, '').replace(/\.00$/, '');
}
