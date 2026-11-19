import { formatCents } from '@pos-saas/money';
import { useEffect, useLayoutEffect, useRef, type ReactElement } from 'react';

import type { CheckoutProblem } from '../../shared/pos-api';

interface PrintQuestionProps {
  readonly folio: string;
  readonly changeCents: number;
  /** Devices that failed after the sale was recorded, such as the drawer. */
  readonly problems: readonly CheckoutProblem[];
  /** True while the ticket is being sent, so a second key does not print it twice. */
  readonly isBusy: boolean;
  readonly onPrint: () => void;
  readonly onSkip: () => void;
}

/**
 * Asks whether to print the ticket of a sale that is already recorded (ADR 0074). The change stays on the screen while
 * the cashier answers. Enter prints, which is the button with the focus; Esc or N leaves the sale without paper.
 *
 * @param props.folio the folio of the recorded sale
 * @param props.changeCents the cash to give back
 * @param props.problems devices that failed after the sale was recorded
 * @param props.isBusy whether the ticket is being sent
 * @param props.onPrint called when the cashier wants the ticket
 * @param props.onSkip called when the cashier does not want it
 * @returns the question
 */
export function PrintQuestion({ folio, changeCents, problems, isBusy, onPrint, onSkip }: PrintQuestionProps): ReactElement {
  const printRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    printRef.current?.focus();
  }, []);

  useLayoutEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const answer = answerOf(event.key);
      if (answer === null) {
        return;
      }
      // Without this, Enter would also press the focused button and print twice.
      event.preventDefault();
      if (isBusy) {
        return;
      }
      if (answer === 'print') {
        onPrint();
      } else {
        onSkip();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <div className="payment-done" role="group" aria-labelledby="print-question">
      <p className="payment-folio">Folio {folio}</p>
      <p className="payment-change" role="status" aria-label="Cambio a entregar">
        {changeCents === 0 ? 'Sin cambio' : `Entrega ${formatCents(changeCents)} de cambio`}
      </p>
      {problems.map((problem) => (
        <p key={problem.device} className="notice" role="alert">
          La venta quedó registrada, pero falló un aparato: {problem.message}
        </p>
      ))}
      <p id="print-question" className="print-question">
        ¿Imprimir ticket?
      </p>
      <button type="button" className="button" disabled={isBusy} onClick={onSkip}>
        No imprimir <kbd>Esc</kbd> <kbd>N</kbd>
      </button>
      <button ref={printRef} type="button" className="button button-primary" disabled={isBusy} onClick={onPrint}>
        Imprimir <kbd>Enter</kbd>
      </button>
    </div>
  );
}

function answerOf(key: string): 'print' | 'skip' | null {
  if (key === 'Enter') {
    return 'print';
  }
  return key === 'Escape' || key === 'n' || key === 'N' ? 'skip' : null;
}
