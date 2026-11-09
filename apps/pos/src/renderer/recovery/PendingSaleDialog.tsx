import { formatCents } from '@pos-saas/money';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import type { PendingSale } from '../../shared/pos-api';
import { PaymentForm } from '../checkout/PaymentForm';
import { formatQuantity, formatSaleMoment } from '../sale/format';
import type { PendingSaleAnswer } from './use-pending-sales';

type Step = 'ask' | 'pay';

interface PendingSaleDialogProps {
  /** The sales left to resolve, oldest first. There is at least one. */
  readonly sales: readonly PendingSale[];
  /** Saves an answer. A rejected promise keeps the sale on the screen with a message. */
  readonly onAnswer: (saleId: string, answer: PendingSaleAnswer) => Promise<void>;
}

/**
 * Asks about the sales a power cut left unresolved, one at a time. Until they are answered the register cannot sell, so
 * none is forgotten (RF-017). The keyboard rests on the dialog rather than on a button, so the Enter that ends a scan
 * does nothing.
 *
 * @param props.sales the sales left to resolve
 * @param props.onAnswer saves what the cashier says about a sale
 * @returns the dialog
 */
export function PendingSaleDialog({ sales, onAnswer }: PendingSaleDialogProps): ReactElement {
  const sale = sales[0]!;
  const [step, setStep] = useState<Step>('ask');
  const [saveFailed, setSaveFailed] = useState(false);
  const isSaving = useRef(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const contentRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  useEffect(() => {
    setStep('ask');
    contentRef.current?.focus();
  }, [sale.id]);

  const answer = (choice: PendingSaleAnswer): void => {
    if (isSaving.current) {
      return;
    }
    isSaving.current = true;
    setSaveFailed(false);
    onAnswer(sale.id, choice)
      .catch(() => {
        setSaveFailed(true);
        contentRef.current?.focus();
      })
      .finally(() => {
        isSaving.current = false;
      });
  };

  // On the window, because a click on the backdrop leaves the keyboard outside the dialog. It runs after every render
  // so the keys always answer for the sale on the screen.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (step !== 'ask') {
        return;
      }
      if (event.key === 'F2') {
        event.preventDefault();
        setStep('pay');
      } else if (event.key === 'F4') {
        event.preventDefault();
        answer({ kind: 'cancel' });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <dialog ref={dialogRef} className="recovery" aria-labelledby="recovery-title" closedby="none">
      <section ref={contentRef} className="recovery-content" tabIndex={-1}>
        <h2 id="recovery-title">¿Se cobró esta venta?</h2>
        <p>La caja se cerró antes de terminarla. No cuenta en existencias ni en el corte hasta que respondas.</p>
        <div className="recovery-ticket">
          <p className="recovery-moment">{formatSaleMoment(sale.occurredAt)}</p>
          <div className="recovery-lines">
            <table>
              <thead className="visually-hidden">
                <tr>
                  <th scope="col">Producto</th>
                  <th scope="col">Cantidad</th>
                  <th scope="col">Importe</th>
                </tr>
              </thead>
              <tbody>
                {sale.lines.map((line, index) => (
                  <tr key={index}>
                    <td>{line.productName}</td>
                    <td className="line-number">{formatQuantity(line.quantity)}</td>
                    <td className="line-number">{formatCents(line.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="recovery-total">
            <span>Total</span>
            <output aria-label="Total de la venta pendiente">{formatCents(sale.totalCents)}</output>
          </p>
        </div>
        {sales.length > 1 && <p className="recovery-remaining">Quedan {sales.length} ventas por revisar</p>}
        {saveFailed && (
          <p className="notice" role="alert">
            No se guardó tu respuesta. Intenta de nuevo y, si sigue fallando, reinicia la caja.
          </p>
        )}
        {step === 'ask' ? (
          <div className="recovery-actions">
            <button type="button" className="button" onClick={() => answer({ kind: 'cancel' })}>
              No se cobró, cancelar venta <kbd>F4</kbd>
            </button>
            <button type="button" className="button button-primary" onClick={() => setStep('pay')}>
              Sí, se cobró <kbd>F2</kbd>
            </button>
          </div>
        ) : (
          <div className="recovery-payment">
            <h3>¿Con qué se pagó?</h3>
            <PaymentForm
              totalCents={sale.totalCents}
              isBusy={isSaving.current}
              onSubmit={(payment) => answer({ kind: 'confirm', payment })}
              onBack={() => setStep('ask')}
              submitLabel="Registrar cobro"
              backLabel="Volver"
            />
          </div>
        )}
      </section>
    </dialog>
  );
}
