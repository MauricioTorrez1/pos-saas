import { useRef, useState, type KeyboardEvent, type ReactElement } from 'react';

const FAILED = 'No se pudo completar. Intenta de nuevo y, si sigue fallando, reinicia la caja.';
export interface FieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly type?: 'text' | 'password';
  readonly autoFocus?: boolean;
  readonly hint?: string;
  readonly maxLength?: number;
}

/** A labeled box. Enter moves to the next box of the form, and never submits it. */
export function Field({ label, value, onChange, type = 'text', autoFocus = false, hint, maxLength }: FieldProps): ReactElement {
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

export function Message({ text }: { readonly text: string | null }): ReactElement | null {
  return text === null ? null : (
    <p className="notice" role="alert">
      {text}
    </p>
  );
}

/** Runs one request at a time and turns a failure into a message. */
export function useAction(): { isBusy: boolean; message: string | null; setMessage: (text: string | null) => void; run: (work: () => Promise<void>) => void } {
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

