'use client';

import { startTransition, useActionState, type FormEvent } from 'react';
import { formatCents, formatDay, periodicityLabel, rateLabel } from '@/lib/invoicing/messages';
import { EMPTY_GLOBAL_STATE, PERIODICITIES, PERIODICITY_LABELS, type GlobalInvoiceState } from '@/lib/invoicing/types';

interface GlobalInvoicePanelProps {
  action: (previous: GlobalInvoiceState, data: FormData) => Promise<GlobalInvoiceState>;
  /** The day the form starts on: the first day of last month. */
  defaultDay: string;
}

/** How many sales the preview lists before saying how many more there are. */
const SHOWN_SALES = 50;

/**
 * The global invoice to «Público en general»: pick a period, check the sales and the totals per rate, then stamp it.
 * Stamping sends the count of the preview; if the sales moved, nothing is stamped and a fresh preview appears.
 */
export function GlobalInvoicePanel({ action, defaultDay }: GlobalInvoicePanelProps) {
  const [state, formAction, pending] = useActionState(action, EMPTY_GLOBAL_STATE);

  function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.set('intent', 'preview');
    startTransition(() => formAction(data));
  }

  function issue() {
    const data = new FormData();
    data.set('intent', 'issue');
    startTransition(() => formAction(data));
  }

  const shown = state.preview?.result;
  const canIssue = shown !== undefined && shown.closed && shown.saleCount > 0 && shown.existing?.status !== 'stamped';

  return (
    <div className="stack stack--wide">
      <form className="panel form" onSubmit={preview} noValidate>
        <div className="form__row">
          <div className="field field--narrow">
            <label htmlFor="periodicity">Periodicidad</label>
            <select id="periodicity" name="periodicity" defaultValue="monthly" aria-describedby="periodicity-hint">
              {PERIODICITIES.map((periodicity) => (
                <option key={periodicity} value={periodicity}>
                  {PERIODICITY_LABELS[periodicity]}
                </option>
              ))}
            </select>
            <p id="periodicity-hint" className="field__hint">
              Mensual hasta que el contador diga otra cosa.
            </p>
          </div>
          <div className="field field--narrow">
            <label htmlFor="day">Cualquier día del periodo</label>
            <input id="day" name="day" type="date" defaultValue={defaultDay} />
          </div>
        </div>
        <div className="form__actions">
          <button type="submit" className="button button--quiet" disabled={pending}>
            {pending ? 'Calculando…' : 'Ver vista previa'}
          </button>
        </div>
      </form>

      {state.error && (
        <div className="notice notice--danger" role="alert">
          <p>{state.error}</p>
          {state.providerMessage && <p>Facturapi dice: «{state.providerMessage}»</p>}
        </div>
      )}
      {state.issued && (
        <p className="notice notice--ok" role="status">
          Listo: se timbró la factura global de {formatDay(state.issued.periodStart)} a {formatDay(state.issued.periodEnd)} con{' '}
          {state.issued.saleCount} {state.issued.saleCount === 1 ? 'venta' : 'ventas'} por{' '}
          {formatCents(state.issued.totalCents ?? state.issued.expectedTotalCents)}. UUID: {state.issued.fiscalUuid}
        </p>
      )}

      {shown && (
        <section className="panel stack" aria-labelledby="global-preview-title">
          <h2 id="global-preview-title">
            Vista previa: {periodicityLabel(shown.periodicity).toLowerCase()} del {formatDay(shown.periodStart)} al{' '}
            {formatDay(shown.periodEnd)}
          </h2>
          {!shown.closed && (
            <p className="notice">El periodo todavía no termina; podrás timbrarla a partir del día siguiente a su cierre.</p>
          )}
          {shown.closed && (
            <p className="field__hint">El SAT pide emitirla a más tardar el {formatDay(shown.deadline)} (72 horas después del cierre).</p>
          )}
          {shown.existing?.status === 'stamped' && (
            <p className="notice">Este periodo ya tiene su factura global (UUID {shown.existing.fiscalUuid}).</p>
          )}
          <p>
            {shown.saleCount} {shown.saleCount === 1 ? 'venta' : 'ventas'} sin factura por {formatCents(shown.totalCents)}.
            {shown.individuallyInvoiced > 0 &&
              ` Se dejan fuera ${shown.individuallyInvoiced} con factura propia.`}{' '}
            Forma de pago: {shown.paymentForm}.
          </p>
          {shown.byRate.length > 0 && (
            <table className="table" aria-label="Totales por tasa">
              <thead>
                <tr>
                  <th scope="col">Tasa</th>
                  <th scope="col">Base</th>
                  <th scope="col">IVA</th>
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {shown.byRate.map((rate) => (
                  <tr key={String(rate.taxRateBasisPoints)}>
                    <td>{rateLabel(rate.taxRateBasisPoints)}</td>
                    <td>{formatCents(rate.baseCents)}</td>
                    <td>{formatCents(rate.taxCents)}</td>
                    <td>{formatCents(rate.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {shown.sales.length > 0 && (
            <details>
              <summary>Ver las ventas incluidas</summary>
              <ul className="stack">
                {shown.sales.slice(0, SHOWN_SALES).map((sale) => (
                  <li key={sale.saleId}>
                    Folio {sale.folio} · {formatDay(sale.day)} · {formatCents(sale.totalCents)}
                    {sale.day < shown.periodStart && ' (llegó tarde de un periodo ya facturado)'}
                  </li>
                ))}
              </ul>
              {shown.sales.length > SHOWN_SALES && <p>…y {shown.sales.length - SHOWN_SALES} más.</p>}
            </details>
          )}
          {canIssue && (
            <div className="form__actions">
              <button type="button" className="button" onClick={issue} disabled={pending}>
                {pending ? 'Timbrando…' : `Timbrar factura global de ${shown.saleCount} ${shown.saleCount === 1 ? 'venta' : 'ventas'}`}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
