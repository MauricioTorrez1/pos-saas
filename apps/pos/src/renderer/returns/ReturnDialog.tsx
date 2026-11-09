import { formatCents, formatUnitPriceE4 } from '@pos-saas/money';
import { useMemo, useState, type ReactElement } from 'react';

import type { UserSummary } from '../../shared/auth';
import type { PosApi } from '../../shared/pos-api';
import { allocateRefund, refundForLine, type PolicyViolation, type RefundShare } from '../../shared/returns';
import type { ReturnableLine, ReturnableSale, ReturnResult } from '../../shared/returns-api';
import { formatQuantity, formatSaleMoment } from '../sale/format';
import { Field, Message, useAction } from '../ui/form-parts';
import { ModalDialog } from '../ui/ModalDialog';
import { useWindowKeys } from '../ui/use-window-keys';

const MILLI_PER_UNIT = 1000;
const METHOD_LABELS = { cash: 'Efectivo', transfer: 'Transferencia', card: 'Tarjeta', card_manual: 'Tarjeta' } as const;
const VIOLATION_TEXT: Readonly<Record<PolicyViolation, string>> = {
  older_than_window: 'tiene más de 30 días',
  measured_product: 'lleva producto cortado a la medida',
};

interface ReturnDialogProps {
  readonly posApi: PosApi;
  readonly user: UserSummary;
  /** Called after a return was recorded, so the cash of the register is read again. */
  readonly onReturned: () => void;
  readonly onClose: () => void;
}

/**
 * Takes back what a customer returns: look up the sale by the folio on the ticket, say how much of each line comes back
 * and why, and see what is given back by each means before confirming (RF-019). The owner authorizes every return, so a
 * cashier asks for their PIN.
 *
 * @param props.posApi bridge to the main process
 * @param props.user who is signed in
 * @param props.onReturned called after a return was recorded
 * @param props.onClose called when the dialog is done
 * @returns the dialog
 */
export function ReturnDialog({ posApi, user, onReturned, onClose }: ReturnDialogProps): ReactElement {
  const [sale, setSale] = useState<ReturnableSale | null>(null);
  const [done, setDone] = useState<Extract<ReturnResult, { status: 'returned' }> | null>(null);

  return (
    <ModalDialog titleId="return-title" className="cash">
      {done !== null ? (
        <DoneView result={done} onDone={onClose} />
      ) : sale === null ? (
        <FindView posApi={posApi} onFound={setSale} onClose={onClose} />
      ) : (
        <SelectView
          posApi={posApi}
          user={user}
          sale={sale}
          onBack={() => setSale(null)}
          onReturned={(result) => {
            onReturned();
            setDone(result);
          }}
        />
      )}
    </ModalDialog>
  );
}

function FindView({ posApi, onFound, onClose }: { readonly posApi: PosApi; readonly onFound: (sale: ReturnableSale) => void; readonly onClose: () => void }): ReactElement {
  const [folio, setFolio] = useState('');
  const { isBusy, message, setMessage, run } = useAction();

  const find = (): void => {
    if (folio.trim() === '') {
      setMessage('Escribe el folio del ticket, por ejemplo T1-000123.');
      return;
    }
    run(async () => {
      const result = await posApi.findReturnableSale(folio.trim());
      if (result.status === 'found') {
        onFound(result.sale);
      } else {
        setMessage(
          result.status === 'invalid_folio'
            ? 'Eso no parece un folio. Mira el ticket: empieza con T1- y lleva seis números.'
            : 'No hay ninguna venta cobrada con ese folio.',
        );
      }
    });
  };

  useWindowKeys({ F2: find, Enter: find, Escape: onClose }, isBusy);

  return (
    <>
      <h2 id="return-title">Devolución</h2>
      <p>Escribe el folio del ticket del cliente.</p>
      <Field label="Folio del ticket" value={folio} onChange={setFolio} autoFocus maxLength={20} hint="Por ejemplo T1-000123" />
      <Message text={message} />
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={onClose}>
          Cerrar <kbd>Esc</kbd>
        </button>
        <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={find}>
          Buscar venta <kbd>Enter</kbd>
        </button>
      </div>
    </>
  );
}

interface SelectViewProps {
  readonly posApi: PosApi;
  readonly user: UserSummary;
  readonly sale: ReturnableSale;
  readonly onBack: () => void;
  readonly onReturned: (result: Extract<ReturnResult, { status: 'returned' }>) => void;
}

function SelectView({ posApi, user, sale, onBack, onReturned }: SelectViewProps): ReactElement {
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const [override, setOverride] = useState(false);
  const { isBusy, message, setMessage, run } = useAction();
  const needsPin = user.role !== 'owner';

  const chosen = useMemo(() => chosenQuantities(sale.lines, quantities), [sale.lines, quantities]);
  const preview = useMemo(() => previewRefund(sale, chosen), [sale, chosen]);

  const fillAll = (): void =>
    setQuantities(Object.fromEntries(sale.lines.filter((line) => line.returnableMilli > 0).map((line) => [line.saleLineId, toText(line.returnableMilli)])));

  const submit = (): void => {
    if (chosen === 'invalid') {
      setMessage('Revisa las cantidades: usa números, y no más de lo que se vendió.');
    } else if (chosen.length === 0) {
      setMessage('Escribe cuánto se devuelve de al menos un producto.');
    } else if (reason.trim() === '') {
      setMessage('Escribe el motivo de la devolución.');
    } else {
      run(async () => {
        const result = await posApi.createReturn({
          saleId: sale.saleId,
          lines: chosen.map(({ line, quantityMilli }) => ({ saleLineId: line.saleLineId, quantityMilli })),
          reason: reason.trim(),
          ...(needsPin ? { ownerPin: pin } : {}),
          ...(override ? { override: true } : {}),
        });
        if (result.status === 'returned') {
          onReturned(result);
        } else {
          setMessage(describeRefusal(result));
        }
      });
    }
  };

  useWindowKeys({ F2: submit, F5: fillAll, Escape: onBack }, isBusy);

  return (
    <>
      <h2 id="return-title">Devolución del ticket {sale.folio}</h2>
      <p className="quantity-price">
        {formatSaleMoment(sale.completedAt)} · {formatCents(sale.totalCents)} · hace {sale.daysOld} {sale.daysOld === 1 ? 'día' : 'días'}
      </p>
      {sale.violations.length > 0 && (
        <p className="notice" role="alert">
          Esta venta {sale.violations.map((violation) => VIOLATION_TEXT[violation]).join(' y ')}. Por regla no se devuelve, y solo el dueño puede hacer la excepción.
        </p>
      )}
      <table className="cash-differences" aria-label="Productos de la venta">
        <thead>
          <tr>
            <th scope="col">Producto</th>
            <th scope="col">Vendido</th>
            <th scope="col">Puede volver</th>
            <th scope="col">Devuelve</th>
          </tr>
        </thead>
        <tbody>
          {sale.lines.map((line) => (
            <tr key={line.saleLineId}>
              <th scope="row">{line.productName}</th>
              <td>
                {formatQuantity({ milli: line.soldMilli, unit: line.unit })} a {formatUnitPriceE4(line.unitPriceE4)}
              </td>
              <td>{formatQuantity({ milli: line.returnableMilli, unit: line.unit })}</td>
              <td>
                <input
                  className="return-quantity"
                  aria-label={`Devuelve de ${line.productName}`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={line.returnableMilli === 0}
                  value={quantities[line.saleLineId] ?? ''}
                  onChange={(event) => setQuantities((current) => ({ ...current, [line.saleLineId]: event.target.value }))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Field label="Motivo de la devolución" value={reason} onChange={setReason} maxLength={200} autoFocus />
      {needsPin && <Field label="PIN del dueño" value={pin} onChange={(value) => setPin(value.replace(/\D/g, ''))} type="password" maxLength={8} hint="El dueño autoriza cada devolución" />}
      {sale.violations.length > 0 && (
        <label className="return-override">
          <input type="checkbox" checked={override} onChange={(event) => setOverride(event.target.checked)} /> El dueño autoriza esta excepción
        </label>
      )}
      <p className="payment-status" role="status" aria-label="Lo que se regresa" data-tone={preview === null ? 'short' : 'ready'}>
        {preview === null ? 'Elige qué se devuelve' : `Se regresan ${formatCents(preview.totalCents)}: ${preview.shares.map(describeShare).join(' y ')}`}
      </p>
      <Message text={message} />
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={onBack}>
          Otro ticket <kbd>Esc</kbd>
        </button>
        <button type="button" className="button" tabIndex={-1} onClick={fillAll}>
          Devolver todo <kbd>F5</kbd>
        </button>
        <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={submit}>
          Registrar devolución <kbd>F2</kbd>
        </button>
      </div>
    </>
  );
}

function DoneView({ result, onDone }: { readonly result: Extract<ReturnResult, { status: 'returned' }>; readonly onDone: () => void }): ReactElement {
  useWindowKeys({ Enter: onDone, Escape: onDone });
  const cash = result.refunds.find((share) => share.method === 'cash');
  return (
    <>
      <h2 id="return-title">Devolución registrada</h2>
      <p className="payment-change" role="status" aria-label="Lo que se entrega">
        {cash === undefined ? 'No se entrega efectivo' : `Entrega ${formatCents(cash.amountCents)} en efectivo`}
      </p>
      <ul className="cash-actions" aria-label="Reembolsos">
        {result.refunds.map((share) => (
          <li key={`${share.method}:${share.reference ?? ''}`}>{describeShare(share)}</li>
        ))}
      </ul>
      <button type="button" className="button button-primary" tabIndex={-1} onClick={onDone}>
        Terminar <kbd>Enter</kbd>
      </button>
    </>
  );
}

function describeShare(share: RefundShare): string {
  const label = METHOD_LABELS[share.method];
  const where = share.method === 'cash' ? '' : share.method === 'transfer' ? ' (regresar por transferencia)' : ' (regresar a la tarjeta)';
  return `${label} ${formatCents(share.amountCents)}${where}`;
}

function describeRefusal(result: Exclude<ReturnResult, { status: 'returned' }>): string {
  switch (result.status) {
    case 'no_session':
      return 'La caja está cerrada. Ábrela para devolver dinero.';
    case 'authorization_required':
      return 'Hace falta el PIN del dueño para autorizar la devolución.';
    case 'wrong_pin':
      return `PIN del dueño incorrecto. Quedan ${result.attemptsLeft} intentos.`;
    case 'locked':
      return 'Demasiados intentos con el PIN del dueño. Espera unos minutos.';
    case 'needs_override':
      return `Esta devolución ${result.violations.map((violation) => VIOLATION_TEXT[violation]).join(' y ')}. Marca la excepción solo si el dueño la autoriza.`;
    case 'exceeds_sold':
      return 'Se quiere devolver más de lo que se vendió. Revisa las cantidades.';
    case 'nothing_selected':
      return 'Escribe cuánto se devuelve de al menos un producto.';
    case 'not_found':
      return 'Esa venta ya no existe. Busca otra vez el ticket.';
  }
}

function toText(milli: number): string {
  const whole = Math.floor(milli / MILLI_PER_UNIT);
  const thousandths = milli % MILLI_PER_UNIT;
  return thousandths === 0 ? String(whole) : `${whole}.${String(thousandths).padStart(3, '0').replace(/0+$/, '')}`;
}

/** What the cashier typed for each line, in thousandths, or `invalid` if any is not a quantity that can come back. */
function chosenQuantities(lines: readonly ReturnableLine[], typed: Readonly<Record<string, string>>): { line: ReturnableLine; quantityMilli: number }[] | 'invalid' {
  const chosen: { line: ReturnableLine; quantityMilli: number }[] = [];
  for (const line of lines) {
    const text = (typed[line.saleLineId] ?? '').trim();
    if (text === '') {
      continue;
    }
    const milli = readThousandths(text.replace(',', '.'));
    if (milli === null || milli < 0 || milli > line.returnableMilli || (line.unit === 'piece' && milli % MILLI_PER_UNIT !== 0)) {
      return 'invalid';
    }
    if (milli > 0) {
      chosen.push({ line, quantityMilli: milli });
    }
  }
  return chosen;
}

function readThousandths(text: string): number | null {
  const match = /^([0-9]*)(?:\.([0-9]{0,3}))?$/.exec(text);
  if (match === null || (match[1] === '' && (match[2] ?? '') === '')) {
    return null;
  }
  return Number(match[1] || '0') * MILLI_PER_UNIT + Number((match[2] ?? '').padEnd(3, '0'));
}

/** What is given back by each means for the lines chosen, the same way the main process will work it out. */
function previewRefund(sale: ReturnableSale, chosen: ReturnType<typeof chosenQuantities>): { totalCents: number; shares: RefundShare[] } | null {
  if (chosen === 'invalid' || chosen.length === 0) {
    return null;
  }
  try {
    const totalCents = chosen.reduce(
      (sum, { line, quantityMilli }) =>
        sum +
        refundForLine({
          lineTotalCents: line.lineTotalCents,
          soldMilli: line.soldMilli,
          returnMilli: quantityMilli,
          alreadyReturnedMilli: line.returnedMilli,
          alreadyRefundedCents: line.refundedCents,
        }),
      0,
    );
    return { totalCents, shares: allocateRefund(totalCents, sale.parts) };
  } catch {
    return null;
  }
}
