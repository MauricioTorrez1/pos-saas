import { formatCents } from '@pos-saas/money';
import { useCallback, useEffect, useState, type ReactElement } from 'react';

import type { PosApi } from '../../shared/pos-api';
import type { SaleSummary, ToolsApi } from '../../shared/register-tools';
import type { ReturnResult } from '../../shared/returns-api';
import { Field, Message, useAction } from '../ui/form-parts';
import { Modal } from '../ui/Modal';

const MOMENT = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
const MAX_REASON_LENGTH = 200;

interface SalesHistoryDialogProps {
  readonly posApi: PosApi;
  readonly toolsApi: ToolsApi;
  readonly isOwner: boolean;
  /** Called after a sale was cancelled, so the cash of the register is read again. */
  readonly onCancelled: () => void;
  readonly onClose: () => void;
}

function stateOf(sale: SaleSummary): { readonly label: string; readonly tone: 'ok' | 'partial' | 'cancelled' } {
  if (sale.refundedCents >= sale.totalCents) {
    return { label: 'Cancelada', tone: 'cancelled' };
  }
  return sale.refundedCents > 0 ? { label: 'Devolución parcial', tone: 'partial' } : { label: 'Cobrada', tone: 'ok' };
}

function describeRefusal(result: Exclude<ReturnResult, { status: 'returned' }>): string {
  switch (result.status) {
    case 'no_session':
      return 'La caja está cerrada. Ábrela con su fondo para poder cancelar una venta, porque el dinero sale del cajón.';
    case 'authorization_required':
      return 'Cancelar una venta lo aprueba el dueño. Escribe su PIN.';
    case 'wrong_pin':
      return `PIN del dueño incorrecto. Quedan ${String(result.attemptsLeft)} intentos.`;
    case 'locked':
      return 'Demasiados intentos con el PIN del dueño. Espera unos minutos.';
    case 'nothing_selected':
    case 'exceeds_sold':
      return 'Esta venta ya no tiene nada por devolver.';
    case 'not_found':
      return 'No encontramos esa venta. Cierra la lista y vuelve a abrirla.';
    case 'needs_override':
      return 'Esta venta necesita la autorización del dueño para cancelarse.';
  }
}

/**
 * The completed sales, the newest first. From here a past sale is cancelled whole: everything that was sold goes back
 * to the shelf and the money goes back the way it came, as a return of every line (ADR 0025), with the reason and the
 * approval of the owner in the audit log. A cancelled sale is never erased.
 *
 * @param props.posApi bridge to the main process
 * @param props.toolsApi bridge for the list of sales
 * @param props.isOwner whether the owner is signed in; a cashier needs the PIN of the owner
 * @param props.onCancelled called after a sale was cancelled
 * @param props.onClose called when the person closes the list
 * @returns the dialog
 */
export function SalesHistoryDialog({ posApi, toolsApi, isOwner, onCancelled, onClose }: SalesHistoryDialogProps): ReactElement {
  const [search, setSearch] = useState('');
  const [sales, setSales] = useState<readonly SaleSummary[] | null>(null);
  const [chosen, setChosen] = useState<SaleSummary | null>(null);
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const { isBusy, message, setMessage, run } = useAction();

  const load = useCallback(
    (text: string) => {
      toolsApi.listRecentSales(text).then(setSales, () => setMessage('No se pudieron leer las ventas. Intenta de nuevo.'));
    },
    [toolsApi, setMessage],
  );

  useEffect(() => load(''), [load]);

  const choose = (sale: SaleSummary): void => {
    setChosen(sale);
    setReason('');
    setPin('');
    setMessage(null);
    setDone(null);
  };

  const cancelChosen = (): void => {
    if (chosen === null) {
      return;
    }
    if (reason.trim() === '') {
      setMessage('Escribe por qué se cancela la venta. Queda en la bitácora.');
      return;
    }
    run(async () => {
      const found = await posApi.findReturnableSale(chosen.folio);
      if (found.status !== 'found') {
        setMessage('No encontramos esa venta. Cierra la lista y vuelve a abrirla.');
        return;
      }
      const lines = found.sale.lines.filter((line) => line.returnableMilli > 0).map((line) => ({ saleLineId: line.saleLineId, quantityMilli: line.returnableMilli }));
      if (lines.length === 0) {
        setMessage('Esta venta ya no tiene nada por devolver.');
        return;
      }
      const result = await posApi.createReturn({
        saleId: found.sale.saleId,
        lines,
        reason: `Cancelación de venta: ${reason.trim()}`.slice(0, MAX_REASON_LENGTH),
        // Cancelling a whole sale is the exception the owner approves, whatever its age or its products.
        override: true,
        ...(isOwner || pin === '' ? {} : { ownerPin: pin }),
      });
      if (result.status !== 'returned') {
        setMessage(describeRefusal(result));
        return;
      }
      setDone(`Venta ${chosen.folio} cancelada. Devuelve ${formatCents(result.totalCents)} al cliente; los productos regresaron al inventario.`);
      setChosen(null);
      load(search);
      onCancelled();
    });
  };

  return (
    <Modal title="Ventas" className="history" onClose={chosen === null ? onClose : () => setChosen(null)}>
      {chosen === null ? (
        <>
          <Field
            label="Buscar por folio"
            value={search}
            onChange={(text) => {
              setSearch(text);
              load(text);
            }}
            autoFocus
            maxLength={20}
            hint="Por ejemplo T1-000123 o solo 123. Vacío muestra las últimas ventas."
          />
          {done !== null && (
            <p className="notice notice-info" role="status">
              {done}
            </p>
          )}
          <Message text={message} />
          <div className="scroll-area history-list">
            {sales !== null && sales.length === 0 && <p className="sale-empty-title">No hay ventas con ese folio.</p>}
            {sales !== null && sales.length > 0 && (
              <table>
                <thead>
                  <tr>
                    <th scope="col">Folio</th>
                    <th scope="col">Fecha</th>
                    <th scope="col">Cajero</th>
                    <th scope="col" className="line-number">
                      Total
                    </th>
                    <th scope="col">Estado</th>
                    <th scope="col">
                      <span className="visually-hidden">Acciones</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((sale) => {
                    const state = stateOf(sale);
                    return (
                      <tr key={sale.saleId}>
                        <td>{sale.folio}</td>
                        <td>{MOMENT.format(new Date(sale.completedAt))}</td>
                        <td>{sale.cashierName ?? '—'}</td>
                        <td className="line-number">{formatCents(sale.totalCents)}</td>
                        <td>
                          <span className="badge" data-tone={state.tone}>
                            {state.label}
                          </span>
                        </td>
                        <td className="line-number">
                          {state.tone !== 'cancelled' && (
                            <button type="button" className="button button-danger button-small" aria-label={`Cancelar la venta ${sale.folio}`} onClick={() => choose(sale)}>
                              Cancelar venta
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
          <div className="payment-actions">
            <button type="button" className="button" tabIndex={-1} onClick={onClose}>
              Cerrar <kbd>Esc</kbd>
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="quantity-price">
            Venta <strong>{chosen.folio}</strong> del {MOMENT.format(new Date(chosen.completedAt))} · {formatCents(chosen.totalCents - chosen.refundedCents)} por devolver
          </p>
          <p className="notice">
            Se devuelve todo lo que queda de esta venta: los productos regresan al inventario y el dinero sale por la misma forma de pago. La venta no se borra; queda marcada como cancelada.
          </p>
          <Field label="Motivo de la cancelación" value={reason} onChange={setReason} autoFocus maxLength={160} hint="Por ejemplo: se cobró dos veces, el cliente se arrepintió." />
          {!isOwner && <Field label="PIN del dueño" numeric="integer" value={pin} onChange={setPin} type="password" maxLength={8} onEnter={cancelChosen} />}
          <Message text={message} />
          <div className="payment-actions">
            <button type="button" className="button" tabIndex={-1} disabled={isBusy} onClick={() => setChosen(null)}>
              Volver <kbd>Esc</kbd>
            </button>
            <button type="button" className="button button-danger" disabled={isBusy} onClick={cancelChosen}>
              Cancelar la venta {chosen.folio}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
