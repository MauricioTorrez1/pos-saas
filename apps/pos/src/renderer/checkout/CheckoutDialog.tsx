import { formatCents } from '@pos-saas/money';
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';

import type { CheckoutProblem, PendingSale, PosApi } from '../../shared/pos-api';
import { describePlan } from './amount-input';
import { describeReprint, REPRINT_FAILED } from './reprint-message';
import { PaymentForm, type EnteredPayment } from './PaymentForm';

const SAVE_FAILED = 'No se pudo registrar el cobro. Intenta de nuevo y, si sigue fallando, reinicia la caja.';
const CANCEL_FAILED = 'No se pudo cancelar la venta. Intenta de nuevo y, si sigue fallando, reinicia la caja.';

type Phase =
  | { readonly kind: 'paying' }
  | { readonly kind: 'done'; readonly folio: string; readonly changeCents: number; readonly problems: readonly CheckoutProblem[] };

interface CheckoutDialogProps {
  readonly posApi: PosApi;
  /** The sale, already saved as pending (ADR 0010). */
  readonly sale: PendingSale;
  /** Called when the dialog is done, with whether the sale was collected. */
  readonly onFinished: (wasCollected: boolean) => void;
}

/**
 * The payment screen. It opens on a sale that is already saved, so a power cut here is recovered at the next start. Esc
 * cancels that sale; F2 collects it, and then the dialog stays until the cashier has seen the change.
 *
 * @param props.posApi bridge to the main process
 * @param props.sale the saved sale
 * @param props.onFinished called once the sale was collected or cancelled
 * @returns the dialog
 */
export function CheckoutDialog({ posApi, sale, onFinished }: CheckoutDialogProps): ReactElement {
  const [phase, setPhase] = useState<Phase>({ kind: 'paying' });
  const [message, setMessage] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [reprintMessage, setReprintMessage] = useState<string | null>(null);
  const isWorking = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  // The form takes the keyboard when it appears, and a browser does not focus anything inside a closed dialog, so the
  // form is drawn only once the dialog is open.
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      dialog.showModal();
    }
    setIsOpen(true);
  }, []);

  const run = async (work: () => Promise<void>, failure: string): Promise<void> => {
    if (isWorking.current) {
      return;
    }
    isWorking.current = true;
    setIsBusy(true);
    setMessage(null);
    try {
      await work();
    } catch {
      setMessage(failure);
    } finally {
      isWorking.current = false;
      setIsBusy(false);
    }
  };

  const collect = (payment: EnteredPayment): Promise<void> =>
    run(async () => {
      const result = await posApi.checkoutSale({ saleId: sale.id, ...payment });
      if (result.status === 'completed') {
        setPhase({ kind: 'done', folio: result.folio, changeCents: result.changeCents, problems: result.problems });
      } else {
        setMessage(describePlan(result.plan).text);
      }
    }, SAVE_FAILED);

  const reprint = async (): Promise<void> => {
    try {
      setReprintMessage(describeReprint(await posApi.reprintLastTicket()));
    } catch {
      setReprintMessage(REPRINT_FAILED);
    }
  };

  const cancelSale = (): Promise<void> =>
    run(async () => {
      await posApi.cancelPendingSale(sale.id);
      onFinished(false);
    }, CANCEL_FAILED);

  return (
    <dialog ref={dialogRef} className="payment" aria-labelledby="payment-title" closedby="none">
      <h2 id="payment-title">{phase.kind === 'paying' ? 'Cobrar' : 'Venta cobrada'}</h2>
      <p className="payment-total">
        <span>Total</span>
        <output aria-label="Total a cobrar">{formatCents(sale.totalCents)}</output>
      </p>
      {!isOpen ? null : phase.kind === 'paying' ? (
        <PaymentForm
          totalCents={sale.totalCents}
          isBusy={isBusy}
          onSubmit={(payment) => void collect(payment)}
          onBack={() => void cancelSale()}
          submitLabel="Cobrar"
          backLabel="Volver y cancelar la venta"
        />
      ) : (
        <DoneView
          folio={phase.folio}
          changeCents={phase.changeCents}
          problems={phase.problems}
          reprintMessage={reprintMessage}
          onReprint={() => void reprint()}
          onContinue={() => onFinished(true)}
        />
      )}
      {message !== null && (
        <p className="notice" role="alert">
          {message}
        </p>
      )}
    </dialog>
  );
}

interface DoneViewProps {
  readonly folio: string;
  readonly changeCents: number;
  readonly problems: readonly CheckoutProblem[];
  readonly reprintMessage: string | null;
  readonly onReprint: () => void;
  readonly onContinue: () => void;
}

/** Keeps the change on the screen while it is handed over. Enter or Esc starts the next sale, and F2 does not, so a double tap cannot hide the change. */
function DoneView({ folio, changeCents, problems, reprintMessage, onReprint, onContinue }: DoneViewProps): ReactElement {
  useLayoutEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        onContinue();
      } else if (event.key === 'F8') {
        event.preventDefault();
        onReprint();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <div className="payment-done">
      <p className="payment-folio">Folio {folio}</p>
      <p className="payment-change" role="status" aria-label="Cambio a entregar">
        {changeCents === 0 ? 'Sin cambio' : `Entrega ${formatCents(changeCents)} de cambio`}
      </p>
      {problems.map((problem) => (
        <p key={problem.device} className="notice" role="alert">
          La venta quedó registrada, pero falló un aparato: {problem.message}
        </p>
      ))}
      {reprintMessage !== null && (
        <p className="notice notice-info" role="status">
          {reprintMessage}
        </p>
      )}
      <button type="button" className="button" tabIndex={-1} onClick={onReprint}>
        Reimprimir ticket <kbd>F8</kbd>
      </button>
      <button type="button" className="button button-primary" tabIndex={-1} onClick={onContinue}>
        Nueva venta <kbd>Enter</kbd>
      </button>
    </div>
  );
}
