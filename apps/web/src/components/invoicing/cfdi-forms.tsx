'use client';

import { useActionState, useState } from 'react';
import {
  CANCELLATION_MOTIVES,
  EMPTY_CFDI_STATE,
  MOTIVE_LABELS,
  type CancellationStatus,
  type CfdiActionState,
  type CfdiKind,
} from '@/lib/invoicing/types';

type CfdiAction = (previous: CfdiActionState, data: FormData) => Promise<CfdiActionState>;

/** The outcome of a form: what was done, or the error of the core and the provider's own words. */
function Outcome({ state }: { state: CfdiActionState }) {
  if (state.error) {
    return (
      <div className="notice notice--danger" role="alert">
        <p>{state.error}</p>
        {state.providerMessage && <p>Facturapi dice: «{state.providerMessage}»</p>}
      </div>
    );
  }
  return state.done ? (
    <p className="notice notice--ok" role="status">
      {state.done}
    </p>
  ) : null;
}

interface CancelFormProps {
  action: CfdiAction;
  kind: CfdiKind;
  id: string;
  /** Where its cancellation stands, so the form offers a refresh while the SAT has not answered. */
  status: CancellationStatus | null;
  /** UUID of a stamped replacement of this invoice, offered as the substitute of motive 01. */
  substituteFiscalUuid?: string | null;
  /** The motive the form starts on; 04 for a global whose sales were invoiced on their own. */
  defaultMotive?: string;
}

/**
 * Cancels a stamped CFDI with a SAT motive (owner only, ADR 0082). Motive 01 asks for the UUID of the replacement,
 * which must be stamped first. While the cancellation waits for the SAT or the receiver, «Consultar» reads it again.
 */
export function CancelForm({ action, kind, id, status, substituteFiscalUuid = null, defaultMotive }: CancelFormProps) {
  const [state, formAction, pending] = useActionState(action, EMPTY_CFDI_STATE);
  const motives = CANCELLATION_MOTIVES[kind];
  const [motive, setMotive] = useState(defaultMotive ?? (substituteFiscalUuid ? '01' : motives[1]!));
  const waiting = status === 'pending' || status === 'requested';

  return (
    <div className="stack">
      {waiting ? (
        <form action={formAction}>
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="intent" value="refresh" />
          <button type="submit" className="button button--quiet" disabled={pending}>
            {pending ? 'Consultando…' : 'Consultar cancelación'}
          </button>
        </form>
      ) : (
        <details>
          <summary>Cancelar</summary>
          <form action={formAction} className="form">
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="intent" value="cancel" />
            <div className="field">
              <label htmlFor={`motive-${id}`}>Motivo del SAT</label>
              <select id={`motive-${id}`} name="motive" value={motive} onChange={(event) => setMotive(event.target.value)}>
                {motives.map((code) => (
                  <option key={code} value={code}>
                    {MOTIVE_LABELS[code]}
                  </option>
                ))}
              </select>
            </div>
            {motive === '01' && (
              <div className="field">
                <label htmlFor={`substitute-${id}`}>UUID de la factura que la sustituye</label>
                <input
                  id={`substitute-${id}`}
                  name="substitute"
                  className="mono"
                  defaultValue={substituteFiscalUuid ?? ''}
                  aria-describedby={`substitute-hint-${id}`}
                />
                <p id={`substitute-hint-${id}`} className="field__hint">
                  Primero emite la sustituta con «Sustituir»; luego cancela esta.
                </p>
              </div>
            )}
            <div className="form__actions">
              <button type="submit" className="button button--danger" disabled={pending}>
                {pending ? 'Cancelando…' : 'Pedir la cancelación al SAT'}
              </button>
            </div>
          </form>
        </details>
      )}
      <Outcome state={state} />
    </div>
  );
}

interface ReplaceFormProps {
  action: CfdiAction;
  saleId: string;
  invoiceId: string;
}

/** Stamps the invoice that replaces one with errors (SAT relation 04), the first step of a motive 01 cancellation. */
export function ReplaceForm({ action, saleId, invoiceId }: ReplaceFormProps) {
  const [state, formAction, pending] = useActionState(action, EMPTY_CFDI_STATE);
  const fields: Array<[string, string]> = [
    ['legalName', 'Razón social'],
    ['taxId', 'RFC'],
    ['taxRegime', 'Régimen fiscal (clave)'],
    ['cfdiUse', 'Uso del CFDI (clave)'],
    ['zipCode', 'Código postal'],
  ];
  return (
    <details>
      <summary>Sustituir</summary>
      <form action={formAction} className="form">
        <input type="hidden" name="saleId" value={saleId} />
        <input type="hidden" name="replacesInvoiceId" value={invoiceId} />
        {fields.map(([name, label]) => (
          <div className="field" key={name}>
            <label htmlFor={`${name}-${invoiceId}`}>{label}</label>
            <input id={`${name}-${invoiceId}`} name={name} />
          </div>
        ))}
        <div className="form__actions">
          <button type="submit" className="button" disabled={pending}>
            {pending ? 'Timbrando…' : 'Timbrar la sustituta'}
          </button>
        </div>
      </form>
      <Outcome state={state} />
    </details>
  );
}

interface CreditNoteButtonProps {
  action: CfdiAction;
  returnId: string;
  /** The text of the button, which names the return. */
  label: string;
}

/** Stamps the credit note of one return. Pressing it again after a timeout is safe. */
export function CreditNoteButton({ action, returnId, label }: CreditNoteButtonProps) {
  const [state, formAction, pending] = useActionState(action, EMPTY_CFDI_STATE);
  return (
    <form action={formAction} className="stack">
      <input type="hidden" name="returnId" value={returnId} />
      <button type="submit" className="button" disabled={pending}>
        {pending ? 'Timbrando…' : label}
      </button>
      <Outcome state={state} />
    </form>
  );
}
