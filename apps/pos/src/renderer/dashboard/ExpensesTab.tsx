import { parseCents } from '@pos-saas/money';
import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { pesosLabel } from '../../shared/dashboard-format';
import { MAX_EXPENSE_NOTE, type Expense, type ExpenseRefusal, type ExpensesApi } from '../../shared/expenses';
import { CheckField, Field, Message, SelectField } from '../ui/form-parts';
import { todayInRegisterZone } from './period-input';

interface ExpensesTabProps {
  readonly api: ExpensesApi;
  /** The days of the period chosen above: the list shows the expenses whose day falls in them. */
  readonly fromDay: string;
  readonly toDay: string;
  /** The PIN of an owner, when a cashier opened the full summary with it. */
  readonly ownerPin: string | null;
  /** Called after an expense is recorded or voided, so the statement and «Resumen» read again. */
  readonly onChanged: () => void;
}

function refusalText(refusal: ExpenseRefusal): string {
  switch (refusal.status) {
    case 'authorization_required':
      return 'Los gastos son solo para el dueño.';
    case 'wrong_pin':
      return `El PIN no es correcto. Te quedan ${String(refusal.attemptsLeft)} intento(s).`;
    case 'locked':
      return 'Demasiados intentos con el PIN. Espera unos minutos.';
  }
}

function readAmount(text: string): number | null {
  try {
    const cents = parseCents(text.trim());
    return cents > 0 ? cents : null;
  } catch {
    return null;
  }
}

/**
 * «Gastos»: the owner writes down the rent, the power, the wages and what else the business pays, and voids a mistake
 * with a reason (E1-56, ADR 0072). An expense paid with cash from the drawer is also a cash exit of the open session, so
 * the cut subtracts it once.
 *
 * @param props.api the bridge of the expenses
 * @param props.fromDay first day of the list
 * @param props.toDay last day of the list
 * @param props.ownerPin the PIN of an owner, for a cashier
 * @param props.onChanged called after a change
 * @returns the tab
 */
export function ExpensesTab({ api, fromDay, toDay, ownerPin, onChanged }: ExpensesTabProps): ReactElement {
  const [concepts, setConcepts] = useState<readonly string[]>([]);
  const [expenses, setExpenses] = useState<readonly Expense[]>([]);
  const [concept, setConcept] = useState('');
  const [amountText, setAmountText] = useState('');
  const [day, setDay] = useState(() => todayInRegisterZone());
  const [note, setNote] = useState('');
  const [fromDrawer, setFromDrawer] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [isEditingConcepts, setIsEditingConcepts] = useState(false);
  const [conceptsText, setConceptsText] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const pin = ownerPin === null ? {} : { ownerPin };

  const load = useCallback(() => {
    api.list({ fromDay, toDay, ...(ownerPin === null ? {} : { ownerPin }) }).then(
      (result) => {
        if (result.status !== 'ok') {
          setMessage(refusalText(result));
          return;
        }
        setExpenses(result.expenses);
        setConcepts(result.concepts);
        setConcept((current) => (result.concepts.includes(current) ? current : (result.concepts[0] ?? '')));
      },
      () => setMessage('No se pudieron leer los gastos.'),
    );
  }, [api, fromDay, toDay, ownerPin]);

  useEffect(load, [load]);

  const finish = (text: string | null): void => {
    setIsBusy(false);
    setNotice(text);
    load();
    onChanged();
  };

  const record = (): void => {
    const amountCents = readAmount(amountText);
    if (amountCents === null) {
      setMessage('Escribe el monto en pesos, por ejemplo 450 o 450.50.');
      return;
    }
    setIsBusy(true);
    setMessage(null);
    api
      .record({ concept, amountCents, day: fromDrawer ? todayInRegisterZone() : day, note: note.trim() === '' ? null : note, paidFromDrawer: fromDrawer, ...pin })
      .then(
        (result) => {
          if (result.status === 'recorded') {
            setAmountText('');
            setNote('');
            finish(`Listo: ${result.expense.concept} por ${pesosLabel(result.expense.amountCents)}${result.expense.paidFromDrawer ? ', salió de la caja' : ''}.`);
            return;
          }
          setIsBusy(false);
          setMessage(
            result.status === 'invalid'
              ? result.message
              : result.status === 'no_session'
                ? 'Para pagarlo con dinero de la caja, primero abre la caja.'
                : refusalText(result),
          );
        },
        () => {
          setIsBusy(false);
          setMessage('No se pudo guardar el gasto.');
        },
      );
  };

  const confirmVoid = (expense: Expense): void => {
    setIsBusy(true);
    setMessage(null);
    api.void({ id: expense.id, reason: voidReason, ...pin }).then(
      (result) => {
        if (result.status === 'voided') {
          setVoiding(null);
          setVoidReason('');
          finish(
            result.returnedToDrawer
              ? 'Gasto anulado. El efectivo regresó a la caja abierta.'
              : expense.paidFromDrawer
                ? 'Gasto anulado. Su caja ya se cerró, así que el efectivo no se tocó.'
                : 'Gasto anulado.',
          );
          return;
        }
        setIsBusy(false);
        setMessage(
          result.status === 'invalid'
            ? result.message
            : result.status === 'not_found'
              ? 'Ese gasto ya no existe.'
              : result.status === 'already_voided'
                ? 'Ese gasto ya estaba anulado.'
                : refusalText(result),
        );
      },
      () => {
        setIsBusy(false);
        setMessage('No se pudo anular el gasto.');
      },
    );
  };

  const saveConcepts = (): void => {
    setIsBusy(true);
    setMessage(null);
    api.saveConcepts({ concepts: conceptsText.split('\n'), ...pin }).then(
      (result) => {
        setIsBusy(false);
        if (result.status === 'saved') {
          setIsEditingConcepts(false);
          setConcepts(result.concepts);
          setNotice('Conceptos guardados. Los gastos anteriores conservan su concepto.');
          load();
          return;
        }
        setMessage(result.status === 'invalid' ? result.message : refusalText(result));
      },
      () => {
        setIsBusy(false);
        setMessage('No se pudieron guardar los conceptos.');
      },
    );
  };

  const counted = expenses.filter((expense) => expense.voided === null).reduce((sum, expense) => sum + expense.amountCents, 0);

  return (
    <section className="expenses" aria-label="Gastos">
      <Message text={message} />
      {notice !== null && (
        <p className="notice notice-info" role="status">
          {notice}
        </p>
      )}
      <form
        className="expense-form"
        aria-label="Anotar un gasto"
        onSubmit={(event) => {
          event.preventDefault();
          record();
        }}
      >
        <SelectField label="Concepto" value={concept} onChange={setConcept} options={concepts.map((option) => ({ value: option, label: option }))} />
        <Field label="Monto" numeric="decimal" value={amountText} onChange={setAmountText} hint="En pesos. Si recuperas el IVA de este gasto, escríbelo sin IVA." />
        <label className="date-field">
          <span>Fecha</span>
          <input type="date" value={fromDrawer ? todayInRegisterZone() : day} max={todayInRegisterZone()} disabled={fromDrawer} onChange={(event) => setDay(event.target.value)} />
        </label>
        <Field label="Nota" value={note} onChange={setNote} maxLength={MAX_EXPENSE_NOTE} hint="Opcional: recibo, mes, a quién se le pagó" />
        <CheckField label="Lo pagué con dinero de la caja (sale hoy en el corte)" checked={fromDrawer} onChange={setFromDrawer} />
        <button type="submit" className="button button-primary" disabled={isBusy || concept === ''}>
          Anotar gasto
        </button>
      </form>
      <table className="dashboard-table" aria-label="Gastos del periodo">
        <caption>
          Gastos del periodo · cuentan {pesosLabel(counted)}
        </caption>
        <thead>
          <tr>
            <th scope="col">Fecha</th>
            <th scope="col">Concepto</th>
            <th scope="col">Monto</th>
            <th scope="col">Pago</th>
            <th scope="col">Anotó</th>
            <th scope="col">Acción</th>
          </tr>
        </thead>
        <tbody>
          {expenses.map((expense) => (
            <tr key={expense.id} className={expense.voided === null ? undefined : 'expense-voided'}>
              <th scope="row">{expense.day}</th>
              <td>
                {expense.concept}
                {expense.note !== null && <span className="kpi-detail"> · {expense.note}</span>}
                {expense.voided !== null && <span className="kpi-detail"> · Anulado: {expense.voided.reason}</span>}
              </td>
              <td>{pesosLabel(expense.amountCents)}</td>
              <td>{expense.paidFromDrawer ? 'De la caja' : 'Otro medio'}</td>
              <td>{expense.recordedBy}</td>
              <td>
                {expense.voided === null &&
                  (voiding === expense.id ? (
                    <span className="expense-void">
                      <input aria-label="Motivo de la anulación" value={voidReason} maxLength={120} onChange={(event) => setVoidReason(event.target.value)} autoFocus />
                      <button type="button" className="button button-danger" disabled={isBusy || voidReason.trim() === ''} onClick={() => confirmVoid(expense)}>
                        Confirmar
                      </button>
                      <button type="button" className="button" onClick={() => setVoiding(null)}>
                        No
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="link-button" onClick={() => setVoiding(expense.id)}>
                      Anular
                    </button>
                  ))}
              </td>
            </tr>
          ))}
          {expenses.length === 0 && (
            <tr>
              <td colSpan={6}>No hay gastos anotados en este periodo.</td>
            </tr>
          )}
        </tbody>
      </table>
      {isEditingConcepts ? (
        <div className="expense-concepts">
          <label className="field">
            <span>Conceptos, uno por renglón</span>
            <textarea rows={8} value={conceptsText} onChange={(event) => setConceptsText(event.target.value)} />
          </label>
          <button type="button" className="button button-primary" disabled={isBusy} onClick={saveConcepts}>
            Guardar conceptos
          </button>
          <button type="button" className="button" onClick={() => setIsEditingConcepts(false)}>
            Cancelar
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="link-button"
          onClick={() => {
            setConceptsText(concepts.join('\n'));
            setIsEditingConcepts(true);
          }}
        >
          Cambiar la lista de conceptos
        </button>
      )}
    </section>
  );
}
