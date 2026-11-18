'use client';

import { startTransition, useActionState, type FormEvent } from 'react';
import { EMPTY_PRICE_CHANGE, type PriceChangeState } from '@/lib/catalog/action-state';
import { ROUNDINGS, ROUNDING_LABELS } from '@/lib/catalog/types';
import { PricePreview } from './price-preview';

interface PriceChangePanelProps {
  action: (previous: PriceChangeState, data: FormData) => Promise<PriceChangeState>;
}

/**
 * The bulk price change: pick products by name, a percentage and a rounding, look at the preview, then apply it.
 * Applying sends the count of the preview; if the catalog moved, nothing changes and a fresh preview appears.
 */
export function PriceChangePanel({ action }: PriceChangePanelProps) {
  const [state, formAction, pending] = useActionState(action, EMPTY_PRICE_CHANGE);

  function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.set('intent', 'preview');
    startTransition(() => formAction(data));
  }

  function apply() {
    const data = new FormData();
    data.set('intent', 'apply');
    startTransition(() => formAction(data));
  }

  const shown = state.preview;

  return (
    <div className="stack stack--wide">
      <form className="panel form" onSubmit={preview} noValidate>
        <div className="form__row">
          <div className="field">
            <label htmlFor="search">Productos cuyo nombre contiene</label>
            <input id="search" name="search" placeholder="Truper (vacío: todos los productos con precio)" autoComplete="off" />
          </div>
          <div className="field field--narrow">
            <label htmlFor="percent">Cambio en %</label>
            <input id="percent" name="percent" inputMode="decimal" placeholder="5 o -2.5" aria-describedby="percent-hint" />
            <p id="percent-hint" className="field__hint">
              Negativo para bajar.
            </p>
          </div>
          <div className="field field--narrow">
            <label htmlFor="rounding">Redondeo</label>
            <select id="rounding" name="rounding" defaultValue="half_peso">
              {ROUNDINGS.map((rounding) => (
                <option key={rounding} value={rounding}>
                  {ROUNDING_LABELS[rounding]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="form__actions">
          <button type="submit" className="button button--quiet" disabled={pending}>
            {pending ? 'Calculando…' : 'Ver vista previa'}
          </button>
        </div>
      </form>

      {state.error && (
        <p className="notice notice--danger" role="alert">
          {state.error}
        </p>
      )}
      {state.staleNotice && (
        <p className="notice" role="alert">
          {state.staleNotice}
        </p>
      )}
      {state.appliedCount !== null && (
        <p className="notice notice--ok" role="status">
          Listo: cambiaron {state.appliedCount} {state.appliedCount === 1 ? 'precio' : 'precios'}. Las cajas los reciben
          en su siguiente sincronización.
        </p>
      )}

      {shown && (
        <section className="panel stack" aria-labelledby="preview-title">
          <h2 id="preview-title">
            Vista previa: {shown.request.percent.startsWith('-') ? '' : '+'}
            {shown.request.percent}% {shown.request.search ? `a «${shown.request.search}»` : 'a todo el catálogo'}
          </h2>
          <PricePreview result={shown.result} />
          {shown.result.count > 0 && (
            <div className="form__actions">
              <button type="button" className="button" onClick={apply} disabled={pending}>
                {pending ? 'Aplicando…' : `Aplicar a ${shown.result.count} ${shown.result.count === 1 ? 'producto' : 'productos'}`}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
