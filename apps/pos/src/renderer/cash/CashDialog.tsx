import { formatCents } from '@pos-saas/money';
import { useRef, useState, type KeyboardEvent, type ReactElement } from 'react';

import type { UserSummary } from '../../shared/auth';
import { countCash, DENOMINATIONS_CENTS } from '../../shared/cash';
import type { CashCut, CashMovementKind, CashStatus, CutComparisonView } from '../../shared/cash-api';
import type { PosApi } from '../../shared/pos-api';
import { readTypedCents } from '../checkout/amount-input';
import { formatSignedCents } from '../sale/format';
import { ModalDialog } from '../ui/ModalDialog';
import { useWindowKeys } from '../ui/use-window-keys';

const MOMENT = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
const FAILED = 'No se pudo completar. Intenta de nuevo y, si sigue fallando, reinicia la caja.';
const INVALID_AMOUNT = 'Escribe solo números, por ejemplo 500 o 500.50.';

type View =
  | { readonly kind: 'summary' }
  | { readonly kind: 'movement'; readonly movement: CashMovementKind }
  | { readonly kind: 'close' }
  | { readonly kind: 'cut'; readonly cut: CashCut }
  | { readonly kind: 'limit' };

interface CashDialogProps {
  readonly posApi: PosApi;
  readonly user: UserSummary;
  readonly status: CashStatus;
  /** Called with the new status after anything changed. */
  readonly onStatusChange: (status: CashStatus) => void;
  readonly onClose: () => void;
}

/**
 * Everything about the cash of the register in one place, all from the keyboard: open it with a float, put cash in or
 * take it out with a reason, change the withdrawal limit, and make the cut (RF-024 to RF-027). Only the owner sees what
 * the drawer should hold, so a cashier counts without knowing the answer.
 *
 * @param props.posApi bridge to the main process
 * @param props.user who is signed in
 * @param props.status how the cash stands
 * @param props.onStatusChange called with the status after a change
 * @param props.onClose called when the dialog is done
 * @returns the dialog
 */
export function CashDialog({ posApi, user, status, onStatusChange, onClose }: CashDialogProps): ReactElement {
  const [view, setView] = useState<View>({ kind: 'summary' });
  const back = (): void => setView({ kind: 'summary' });

  return (
    <ModalDialog titleId="cash-title" className="cash">
      {view.kind === 'summary' && (
        <SummaryView posApi={posApi} user={user} status={status} onStatusChange={onStatusChange} onClose={onClose} onGo={setView} />
      )}
      {view.kind === 'movement' && (
        <MovementView posApi={posApi} user={user} movement={view.movement} onStatusChange={onStatusChange} onBack={back} />
      )}
      {view.kind === 'close' && <CloseView posApi={posApi} onStatusChange={onStatusChange} onBack={back} onCut={(cut) => setView({ kind: 'cut', cut })} />}
      {view.kind === 'cut' && <CutView cut={view.cut} onDone={onClose} />}
      {view.kind === 'limit' && <LimitView posApi={posApi} onStatusChange={onStatusChange} onBack={back} current={status.withdrawalLimitCents} />}
    </ModalDialog>
  );
}

interface FieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: 'text' | 'password';
  readonly autoFocus?: boolean;
  readonly hint?: string;
  readonly maxLength?: number;
}

/** A labeled box. Enter moves to the next box of the form, and never submits it. */
function Field({ label, value, onChange, type = 'text', autoFocus = false, hint, maxLength }: FieldProps): ReactElement {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <label className="payment-field">
      <span>{label}</span>
      <input
        ref={ref}
        aria-label={label}
        type={type}
        inputMode={type === 'password' ? 'numeric' : 'decimal'}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        maxLength={maxLength}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={moveOnEnter}
      />
      {hint !== undefined && <small>{hint}</small>}
    </label>
  );
}

function moveOnEnter(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key !== 'Enter') {
    return;
  }
  event.preventDefault();
  const inputs = [...(event.currentTarget.closest('dialog')?.querySelectorAll<HTMLInputElement>('input') ?? [])];
  inputs[inputs.indexOf(event.currentTarget) + 1]?.focus();
}

function Message({ text }: { readonly text: string | null }): ReactElement | null {
  return text === null ? null : (
    <p className="notice" role="alert">
      {text}
    </p>
  );
}

/** Runs one request at a time and turns a failure into a message. */
function useAction(): { isBusy: boolean; message: string | null; setMessage: (text: string | null) => void; run: (work: () => Promise<void>) => void } {
  const [isBusy, setIsBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const running = useRef(false);
  const run = (work: () => Promise<void>): void => {
    if (running.current) {
      return;
    }
    running.current = true;
    setIsBusy(true);
    setMessage(null);
    work()
      .catch(() => setMessage(FAILED))
      .finally(() => {
        running.current = false;
        setIsBusy(false);
      });
  };
  return { isBusy, message, setMessage, run };
}

interface SummaryViewProps {
  readonly posApi: PosApi;
  readonly user: UserSummary;
  readonly status: CashStatus;
  readonly onStatusChange: (status: CashStatus) => void;
  readonly onClose: () => void;
  readonly onGo: (view: View) => void;
}

function SummaryView({ posApi, user, status, onStatusChange, onClose, onGo }: SummaryViewProps): ReactElement {
  const [floatText, setFloatText] = useState('');
  const { isBusy, message, setMessage, run } = useAction();
  const isOwner = user.role === 'owner';
  const session = status.session;

  const open = (): void => {
    const floatCents = readTypedCents(floatText);
    if (floatCents === null) {
      setMessage(INVALID_AMOUNT);
      return;
    }
    run(async () => {
      const result = await posApi.openCashSession({ floatCents });
      onStatusChange(result.cash);
      onClose();
    });
  };

  useWindowKeys(
    session === null
      ? { F2: open, Escape: onClose }
      : {
          F5: () => onGo({ kind: 'movement', movement: 'in' }),
          F6: () => onGo({ kind: 'movement', movement: 'out' }),
          F7: () => onGo({ kind: 'close' }),
          F8: isOwner ? () => onGo({ kind: 'limit' }) : undefined,
          Escape: onClose,
        },
    isBusy,
  );

  if (session === null) {
    return (
      <>
        <h2 id="cash-title">Abrir la caja</h2>
        <p>La caja está cerrada y no se puede cobrar. Cuenta el efectivo que dejas en el cajón para empezar.</p>
        <Field label="Fondo de caja" value={floatText} onChange={setFloatText} autoFocus hint="Puede ser 0" />
        <Message text={message} />
        <div className="payment-actions">
          <button type="button" className="button" tabIndex={-1} onClick={onClose}>
            Cerrar <kbd>Esc</kbd>
          </button>
          <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={open}>
            Abrir caja <kbd>F2</kbd>
          </button>
        </div>
      </>
    );
  }
  const { totals, expected } = status;
  return (
    <>
      <h2 id="cash-title">Caja abierta</h2>
      <p className="quantity-price">
        Abrió {session.openedBy} · {MOMENT.format(new Date(session.openedAt))} · Fondo {formatCents(session.openingFloatCents)}
      </p>
      {isOwner && totals !== null && expected !== null && (
        <dl className="summary-rows" aria-label="Resumen de la caja">
          <div>
            <dt>Efectivo esperado en el cajón</dt>
            <dd>{formatSignedCents(expected.cashCents)}</dd>
          </div>
          <div>
            <dt>Entradas y salidas de efectivo</dt>
            <dd>
              +{formatCents(totals.cashInCents)} / −{formatCents(totals.cashOutCents)}
            </dd>
          </div>
          <div>
            <dt>Tarjeta</dt>
            <dd>{formatCents(expected.cardCents)}</dd>
          </div>
          <div>
            <dt>Transferencias</dt>
            <dd>{formatCents(expected.transferCents)}</dd>
          </div>
          <div>
            <dt>Aviso de retiro a partir de</dt>
            <dd>{formatCents(status.withdrawalLimitCents)}</dd>
          </div>
        </dl>
      )}
      {status.shouldWithdraw && (
        <p className="notice" role="alert">
          Ya hay mucho efectivo en el cajón. Haz un retiro parcial para guardarlo (F6).
        </p>
      )}
      <ul className="cash-actions">
        <li>
          <kbd>F5</kbd> Entrada de efectivo
        </li>
        <li>
          <kbd>F6</kbd> Salida de efectivo
        </li>
        <li>
          <kbd>F7</kbd> Hacer el corte y cerrar la caja
        </li>
        {isOwner && (
          <li>
            <kbd>F8</kbd> Cambiar el aviso de retiro
          </li>
        )}
        <li>
          <kbd>Esc</kbd> Volver a la venta
        </li>
      </ul>
    </>
  );
}

interface MovementViewProps {
  readonly posApi: PosApi;
  readonly user: UserSummary;
  readonly movement: CashMovementKind;
  readonly onStatusChange: (status: CashStatus) => void;
  readonly onBack: () => void;
}

function MovementView({ posApi, user, movement, onStatusChange, onBack }: MovementViewProps): ReactElement {
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const { isBusy, message, setMessage, run } = useAction();
  const needsOwner = movement === 'out' && user.role !== 'owner';

  const submit = (): void => {
    const amountCents = readTypedCents(amountText);
    if (amountCents === null || amountCents === 0) {
      setMessage(amountCents === 0 ? 'Escribe cuánto efectivo es.' : INVALID_AMOUNT);
    } else if (reason.trim() === '') {
      setMessage('Escribe el motivo. Sin motivo no se puede registrar.');
    } else {
      run(async () => {
        const result = await posApi.recordCashMovement({ kind: movement, amountCents, reason: reason.trim(), ...(needsOwner ? { ownerPin: pin } : {}) });
        if (result.status === 'recorded') {
          onStatusChange(result.cash);
          onBack();
        } else {
          setMessage(describeMovementRefusal(result));
        }
      });
    }
  };

  useWindowKeys({ F2: submit, Escape: onBack }, isBusy);

  return (
    <>
      <h2 id="cash-title">{movement === 'in' ? 'Entrada de efectivo' : 'Salida de efectivo'}</h2>
      <Field label="Monto" value={amountText} onChange={setAmountText} autoFocus />
      <Field label="Motivo" value={reason} onChange={setReason} maxLength={200} hint={movement === 'out' ? 'Por ejemplo: pago a proveedor' : 'Por ejemplo: cambio del dueño'} />
      {needsOwner && <Field label="PIN del dueño" value={pin} onChange={(value) => setPin(value.replace(/\D/g, ''))} type="password" maxLength={8} hint="Un cajero necesita al dueño para sacar efectivo" />}
      <Message text={message} />
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={onBack}>
          Volver <kbd>Esc</kbd>
        </button>
        <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={submit}>
          Registrar <kbd>F2</kbd>
        </button>
      </div>
    </>
  );
}

function describeMovementRefusal(result: Exclude<Awaited<ReturnType<PosApi['recordCashMovement']>>, { status: 'recorded' }>): string {
  switch (result.status) {
    case 'no_session':
      return 'La caja está cerrada. Ábrela primero.';
    case 'authorization_required':
      return 'Para sacar efectivo hace falta el PIN del dueño.';
    case 'wrong_pin':
      return `PIN del dueño incorrecto. Quedan ${result.attemptsLeft} intentos.`;
    case 'locked':
      return 'Demasiados intentos con el PIN del dueño. Espera unos minutos.';
  }
}

interface CloseViewProps {
  readonly posApi: PosApi;
  readonly onStatusChange: (status: CashStatus) => void;
  readonly onBack: () => void;
  readonly onCut: (cut: CashCut) => void;
}

function CloseView({ posApi, onStatusChange, onBack, onCut }: CloseViewProps): ReactElement {
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [cardText, setCardText] = useState('');
  const [transferText, setTransferText] = useState('');
  const [reason, setReason] = useState('');
  const [comparison, setComparison] = useState<CutComparisonView | null>(null);
  const { isBusy, message, setMessage, run } = useAction();

  const submit = (): void => {
    const card = readTypedCents(cardText);
    const transfer = readTypedCents(transferText);
    const numbers: Record<number, number> = {};
    for (const [denomination, text] of Object.entries(counts)) {
      const count = text.trim() === '' ? 0 : Number(text);
      if (!Number.isSafeInteger(count) || count < 0) {
        setMessage('Cuenta los billetes y las monedas con números enteros.');
        return;
      }
      numbers[Number(denomination)] = count;
    }
    if (card === null || transfer === null) {
      setMessage(INVALID_AMOUNT);
      return;
    }
    run(async () => {
      const result = await posApi.closeCashSession({ counts: numbers, cardCountedCents: card, transferCountedCents: transfer, reason: reason.trim() });
      if (result.status === 'closed') {
        onStatusChange(await posApi.getCashStatus());
        onCut(result.cut);
      } else if (result.status === 'reason_required') {
        setComparison(result.comparison);
        setMessage('No cuadra. Escribe el motivo de la diferencia y vuelve a oprimir F2.');
      } else if (result.status === 'pending_sales') {
        setMessage(`Todavía hay ${result.count} venta(s) sin resolver. Respóndelas antes de hacer el corte.`);
      } else {
        setMessage('La caja ya estaba cerrada.');
      }
    });
  };

  useWindowKeys({ F2: submit, Escape: onBack }, isBusy);

  const countedCash = (() => {
    try {
      return countCash(Object.fromEntries(Object.entries(counts).map(([denomination, text]) => [denomination, text.trim() === '' ? 0 : Number(text)])));
    } catch {
      return null;
    }
  })();

  return (
    <>
      <h2 id="cash-title">Corte de caja</h2>
      <p>Cuenta lo que hay en el cajón, billete por billete, y lo que marcan los vouchers.</p>
      <div className="cash-counts">
        {DENOMINATIONS_CENTS.map((denomination) => (
          <Field
            key={denomination}
            label={`${denomination >= 2000 ? 'Billetes de' : 'Monedas de'} ${formatCents(denomination).replace('.00', '')}`}
            value={counts[denomination] ?? ''}
            onChange={(value) => setCounts((current) => ({ ...current, [denomination]: value.replace(/\D/g, '') }))}
            autoFocus={denomination === DENOMINATIONS_CENTS[0]}
          />
        ))}
      </div>
      <p className="payment-folio">Efectivo contado: {countedCash === null ? '—' : formatCents(countedCash)}</p>
      <Field label="Total de vouchers de tarjeta" value={cardText} onChange={setCardText} />
      <Field label="Total de transferencias recibidas" value={transferText} onChange={setTransferText} />
      {comparison !== null && <Differences comparison={comparison} />}
      <Field label="Motivo de la diferencia" value={reason} onChange={setReason} maxLength={200} hint="Solo si no cuadra" />
      <Message text={message} />
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={onBack}>
          Volver <kbd>Esc</kbd>
        </button>
        <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={submit}>
          Hacer el corte <kbd>F2</kbd>
        </button>
      </div>
    </>
  );
}

function Differences({ comparison }: { readonly comparison: CutComparisonView }): ReactElement {
  const rows = [
    ['Efectivo', comparison.cash],
    ['Tarjeta', comparison.card],
    ['Transferencias', comparison.transfer],
  ] as const;
  return (
    <table className="cash-differences" aria-label="Diferencias del corte">
      <thead>
        <tr>
          <th scope="col">Forma de pago</th>
          <th scope="col">Esperado</th>
          <th scope="col">Contado</th>
          <th scope="col">Diferencia</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([name, line]) => (
          <tr key={name}>
            <th scope="row">{name}</th>
            <td>{formatSignedCents(line.expectedCents)}</td>
            <td>{formatSignedCents(line.countedCents)}</td>
            <td data-off={line.differenceCents !== 0}>{formatDifference(line.differenceCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function formatDifference(differenceCents: number): string {
  if (differenceCents === 0) {
    return 'Cuadra';
  }
  return `${differenceCents < 0 ? 'Faltan' : 'Sobran'} ${formatCents(Math.abs(differenceCents))}`;
}

function CutView({ cut, onDone }: { readonly cut: CashCut; readonly onDone: () => void }): ReactElement {
  useWindowKeys({ Enter: onDone, Escape: onDone });
  return (
    <>
      <h2 id="cash-title">Caja cerrada</h2>
      <p className="quantity-price">
        Corte de {cut.cutBy} · {MOMENT.format(new Date(cut.cutAt))}
      </p>
      <Differences comparison={cut} />
      {cut.reason !== null && <p>Motivo: {cut.reason}</p>}
      <p className="payment-change" role="status" aria-label="Resultado del corte">
        {cut.isBalanced ? 'El corte cuadra' : 'El corte quedó con diferencia'}
      </p>
      <button type="button" className="button button-primary" tabIndex={-1} onClick={onDone}>
        Terminar <kbd>Enter</kbd>
      </button>
    </>
  );
}

interface LimitViewProps {
  readonly posApi: PosApi;
  readonly current: number;
  readonly onStatusChange: (status: CashStatus) => void;
  readonly onBack: () => void;
}

function LimitView({ posApi, current, onStatusChange, onBack }: LimitViewProps): ReactElement {
  const [text, setText] = useState('');
  const { isBusy, message, setMessage, run } = useAction();

  const submit = (): void => {
    const limitCents = readTypedCents(text);
    if (limitCents === null || limitCents === 0) {
      setMessage(INVALID_AMOUNT);
      return;
    }
    run(async () => {
      onStatusChange(await posApi.setWithdrawalLimit({ limitCents }));
      onBack();
    });
  };

  useWindowKeys({ F2: submit, Escape: onBack }, isBusy);

  return (
    <>
      <h2 id="cash-title">Aviso de retiro</h2>
      <p>La caja avisa cuando el efectivo del cajón pasa de {formatCents(current)}. Avisa, pero nunca frena una venta.</p>
      <Field label="Nuevo límite" value={text} onChange={setText} autoFocus />
      <Message text={message} />
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={onBack}>
          Volver <kbd>Esc</kbd>
        </button>
        <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={submit}>
          Guardar <kbd>F2</kbd>
        </button>
      </div>
    </>
  );
}
