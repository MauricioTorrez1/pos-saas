'use client';

import { startTransition, useActionState, type FormEvent } from 'react';
import { EMPTY_PRICE_FORM, type PriceFormState } from '@/lib/catalog/action-state';
import { formatPrice } from '@/lib/catalog/decimal-text';

interface PriceFormProps {
  action: (previous: PriceFormState, data: FormData) => Promise<PriceFormState>;
  currentPrice: string;
}

/** Changes the price of one product. Shown only to the owner; the core audits the old and the new price. */
export function PriceForm({ action, currentPrice }: PriceFormProps) {
  const [state, formAction, pending] = useActionState(action, EMPTY_PRICE_FORM);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <form className="form form--inline" onSubmit={submit} noValidate>
      <div className="field field--narrow">
        <label htmlFor="newPrice">Precio nuevo con IVA</label>
        <input
          id="newPrice"
          name="unitPrice"
          inputMode="decimal"
          defaultValue={currentPrice}
          aria-invalid={Boolean(state.error)}
        />
      </div>
      <button type="submit" className="button" disabled={pending}>
        {pending ? 'Cambiando…' : 'Cambiar precio'}
      </button>
      {state.error && (
        <p className="field__error" role="alert">
          {state.error}
        </p>
      )}
      {state.savedPrice && (
        <p className="notice notice--ok" role="status">
          Precio cambiado a {formatPrice(state.savedPrice)}.
        </p>
      )}
    </form>
  );
}
