import { useEffect, useRef, useState, type FormEvent, type ReactElement, type SyntheticEvent } from 'react';

import {
  ACCENTS,
  MAX_BUSINESS_NAME_LENGTH,
  TEXT_SIZES,
  THEMES,
  type Accent,
  type Appearance,
  type TextSize,
  type Theme,
} from '../../shared/appearance';

const ACCENT_LABELS: Readonly<Record<Accent, string>> = {
  yellow: 'Amarillo',
  orange: 'Naranja',
  red: 'Rojo',
  blue: 'Azul',
  green: 'Verde',
  purple: 'Morado',
};

const TEXT_SIZE_LABELS: Readonly<Record<TextSize, string>> = {
  normal: 'Normal',
  large: 'Grande',
  'extra-large': 'Muy grande',
};

const THEME_LABELS: Readonly<Record<Theme, string>> = {
  light: 'Claro',
  dark: 'Oscuro',
};

interface ChoiceGroupProps<T extends string> {
  readonly legend: string;
  readonly name: string;
  readonly options: readonly T[];
  readonly labels: Readonly<Record<T, string>>;
  readonly value: T;
  readonly variant: 'swatch' | 'segment';
  readonly onChange: (value: T) => void;
}

/** A set of radio buttons, so the arrow keys move through the options. */
function ChoiceGroup<T extends string>({ legend, name, options, labels, value, variant, onChange }: ChoiceGroupProps<T>): ReactElement {
  return (
    <fieldset className={`choices choices-${variant}`}>
      <legend>{legend}</legend>
      <div className="choices-options">
        {options.map((option) => (
          <label key={option} className="choice">
            <input
              className="visually-hidden"
              type="radio"
              name={name}
              value={option}
              checked={option === value}
              onChange={() => onChange(option)}
            />
            <span className="choice-face" data-paint={variant === 'swatch' ? option : undefined}>
              {labels[option]}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

interface AppearanceDialogProps {
  /** The appearance as it is saved now. */
  readonly saved: Appearance;
  /** Called with each change, so the owner sees it before saving. */
  readonly onPreview: (appearance: Appearance) => void;
  /** Saves the appearance. A rejected promise keeps the dialog open with a message. */
  readonly onSave: (appearance: Appearance) => Promise<void>;
  readonly onClose: () => void;
}

/**
 * Where the owner changes how the register looks. The browser's modal dialog keeps the keyboard inside it, and Esc
 * cancels it.
 *
 * @param props.saved the current appearance
 * @param props.onPreview shows a change on the screen behind the dialog
 * @param props.onSave keeps the new appearance
 * @param props.onClose called when the dialog is done
 * @returns the dialog
 */
export function AppearanceDialog({ saved, onPreview, onSave, onClose }: AppearanceDialogProps): ReactElement {
  const [draft, setDraft] = useState(saved);
  const [saveFailed, setSaveFailed] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  useEffect(() => {
    onPreview(draft);
  }, [draft, onPreview]);

  const change = (update: Partial<Appearance>): void => setDraft((current) => ({ ...current, ...update }));

  const cancel = (): void => {
    onPreview(saved);
    onClose();
  };

  const handleCancelEvent = (event: SyntheticEvent): void => {
    event.preventDefault();
    cancel();
  };

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    onSave({ ...draft, businessName: draft.businessName.trim() }).catch(() => setSaveFailed(true));
  };

  return (
    <dialog ref={dialogRef} className="appearance" aria-labelledby="appearance-title" onCancel={handleCancelEvent}>
      <form onSubmit={handleSubmit}>
        <h2 id="appearance-title">Apariencia de la caja</h2>
        <label className="text-field">
          <span>Nombre del negocio</span>
          <input
            type="text"
            value={draft.businessName}
            maxLength={MAX_BUSINESS_NAME_LENGTH}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => change({ businessName: event.target.value })}
          />
        </label>
        <ChoiceGroup
          legend="Color"
          name="accent"
          options={ACCENTS}
          labels={ACCENT_LABELS}
          value={draft.accent}
          variant="swatch"
          onChange={(accent) => change({ accent })}
        />
        <ChoiceGroup
          legend="Tamaño de letra"
          name="text-size"
          options={TEXT_SIZES}
          labels={TEXT_SIZE_LABELS}
          value={draft.textSize}
          variant="segment"
          onChange={(textSize) => change({ textSize })}
        />
        <ChoiceGroup
          legend="Tema"
          name="theme"
          options={THEMES}
          labels={THEME_LABELS}
          value={draft.theme}
          variant="segment"
          onChange={(theme) => change({ theme })}
        />
        {saveFailed && (
          <p className="notice" role="alert">
            No se pudo guardar la apariencia. Intenta de nuevo y, si sigue fallando, reinicia la caja.
          </p>
        )}
        <div className="appearance-actions">
          <button type="button" className="button" onClick={cancel}>
            Cancelar
          </button>
          <button type="submit" className="button button-primary">
            Guardar apariencia
          </button>
        </div>
      </form>
    </dialog>
  );
}
