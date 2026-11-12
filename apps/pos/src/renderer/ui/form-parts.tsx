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
  /** What Enter does in this box. Without it, Enter moves to the next box. A scanner ends every code with Enter. */
  readonly onEnter?: () => void;
  /** Shown in place of the hint when something about this box is wrong. */
  readonly problem?: string | undefined;
}

/** A labeled box. Enter moves to the next box of the form, and never submits it. */
export function Field({ label, value, onChange, type = 'text', autoFocus = false, hint, maxLength, onEnter, problem }: FieldProps): ReactElement {
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
        aria-invalid={problem === undefined ? undefined : true}
        onKeyDown={onEnter === undefined ? moveOnEnter : (event) => runOnEnter(event, onEnter)}
      />
      {problem !== undefined ? <small className="payment-field-problem">{problem}</small> : hint !== undefined && <small>{hint}</small>}
    </label>
  );
}

function runOnEnter(event: KeyboardEvent<HTMLInputElement>, action: () => void): void {
  if (event.key === 'Enter') {
    event.preventDefault();
    action();
  }
}

function moveOnEnter(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key !== 'Enter') {
    return;
  }
  event.preventDefault();
  moveToNextBox(event.currentTarget);
}

export interface SelectFieldProps<Value extends string> {
  readonly label: string;
  readonly value: Value;
  readonly onChange: (value: Value) => void;
  readonly options: readonly { readonly value: Value; readonly label: string }[];
  readonly disabled?: boolean;
  readonly hint?: string;
}

/** A labeled list of choices. Arrow keys change the choice, and Enter moves to the next box of the form. */
export function SelectField<Value extends string>({ label, value, onChange, options, disabled = false, hint }: SelectFieldProps<Value>): ReactElement {
  return (
    <label className="payment-field">
      <span>{label}</span>
      <select
        aria-label={label}
        className="payment-select"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as Value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            moveToNextBox(event.currentTarget);
          }
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint !== undefined && <small>{hint}</small>}
    </label>
  );
}

/** A box to tick, such as "A la venta". */
export function CheckField({ label, checked, onChange }: { readonly label: string; readonly checked: boolean; readonly onChange: (checked: boolean) => void }): ReactElement {
  return (
    <label className="payment-check">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Moves the keyboard to the next box or list of the dialog the element is in. */
function moveToNextBox(element: HTMLElement): void {
  const boxes = [...(element.closest('dialog')?.querySelectorAll<HTMLElement>('input:not([type="checkbox"]), select') ?? [])];
  boxes[boxes.indexOf(element) + 1]?.focus();
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

