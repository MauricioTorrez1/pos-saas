import { Fragment, useEffect, useState, type ReactElement } from 'react';

import {
  comboLabel,
  comboOf,
  DEFAULT_KEYMAP,
  DEFAULT_TICKET_DESIGN,
  isKeymap,
  KEY_ACTION_LABELS,
  KEY_ACTIONS,
  MAX_TICKET_COPIES,
  MAX_TICKET_EXTRA_LINES,
  problemWithCombo,
  TEXT_SIZE_SCALE,
  TICKET_COLUMN_CHOICES,
  TICKET_FONT_CHOICES,
  TICKET_TEXT_SIZE_CHOICES,
  ticketLineWidth,
  type KeyAction,
  type Keymap,
  type TicketColumns,
  type TicketDesign,
  type TicketFont,
  type TicketTextSize,
  type ToolsApi,
} from '../../shared/register-tools';
import { CheckField, Field, Message, SelectField, useAction } from '../ui/form-parts';
import { Modal } from '../ui/Modal';

type Tab = 'keys' | 'ticket' | 'printer';

const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: 'keys', label: 'Atajos de teclado' },
  { id: 'ticket', label: 'Diseño del ticket' },
  { id: 'printer', label: 'Impresora' },
];

const PAPER_LABELS: Readonly<Record<TicketColumns, string>> = {
  32: 'Papel de 58 mm (32 letras por línea)',
  42: 'Papel de 72 mm (42 letras por línea)',
  48: 'Papel de 80 mm (48 letras por línea)',
};

const FONT_LABELS: Readonly<Record<TicketFont, string>> = {
  a: 'Normal (fuente A)',
  b: 'Compacta (fuente B, caben más letras)',
};

const TEXT_SIZE_LABELS: Readonly<Record<TicketTextSize, string>> = {
  normal: 'Normal',
  tall: 'Alta (doble de alto)',
  large: 'Grande (doble de alto y de ancho)',
};

/** The size of a letter of font A in the preview; the other fonts and sizes scale from it. */
const PREVIEW_LETTER_REM = 0.78;
/** Font B is about three quarters as wide as font A. */
const FONT_B_WIDTH = 0.75;

const MODIFIER_KEYS = ['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'];

interface SettingsDialogProps {
  readonly toolsApi: ToolsApi;
  readonly keymap: Keymap;
  /** Called after the keys were saved, so the sale screen answers to the new ones at once. */
  readonly onKeymapSaved: (keymap: Keymap) => void;
  readonly onClose: () => void;
}

/**
 * The settings of the register, for the owner: which key does what, how the ticket looks, and which printer it goes
 * to. Each tab saves on its own, and the ticket shows a sample before it is saved.
 *
 * @param props.toolsApi bridge for the settings
 * @param props.keymap the keys in use
 * @param props.onKeymapSaved called after the keys were saved
 * @param props.onClose called when the owner closes the settings
 * @returns the dialog
 */
export function SettingsDialog({ toolsApi, keymap, onKeymapSaved, onClose }: SettingsDialogProps): ReactElement {
  const [tab, setTab] = useState<Tab>('keys');
  const [isCapturing, setIsCapturing] = useState(false);
  return (
    // While a key is being captured Esc belongs to the capture, not to the dialog.
    <Modal title="Ajustes de la caja" className="settings" onClose={isCapturing ? () => undefined : onClose}>
      <div className="tabs" role="tablist" aria-label="Secciones de los ajustes">
        {TABS.map(({ id, label }) => (
          <button key={id} type="button" role="tab" className="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>
      <div className="scroll-area settings-body" role="tabpanel">
        {tab === 'keys' && <KeysTab toolsApi={toolsApi} saved={keymap} onSaved={onKeymapSaved} onCapturing={setIsCapturing} />}
        {tab === 'ticket' && <TicketTab toolsApi={toolsApi} />}
        {tab === 'printer' && <PrinterTab toolsApi={toolsApi} />}
      </div>
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={onClose}>
          Cerrar <kbd>Esc</kbd>
        </button>
      </div>
    </Modal>
  );
}

interface KeysTabProps {
  readonly toolsApi: ToolsApi;
  readonly saved: Keymap;
  readonly onSaved: (keymap: Keymap) => void;
  readonly onCapturing: (isCapturing: boolean) => void;
}

function KeysTab({ toolsApi, saved, onSaved, onCapturing }: KeysTabProps): ReactElement {
  const [draft, setDraft] = useState<Keymap>(saved);
  const [capturing, setCapturing] = useState<KeyAction | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const { isBusy, message, run } = useAction();

  useEffect(() => onCapturing(capturing !== null), [capturing, onCapturing]);

  // The next key pressed becomes the key of the action. It is caught before the dialog or the sale can use it.
  useEffect(() => {
    if (capturing === null) {
      return undefined;
    }
    const capture = (event: KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      if (MODIFIER_KEYS.includes(event.key)) {
        return;
      }
      if (event.key === 'Escape') {
        setCapturing(null);
        return;
      }
      const combo = comboOf(event);
      if (combo === null) {
        const name = event.key.length === 1 ? event.key.toUpperCase() : event.key;
        setProblem(problemWithCombo(`${event.ctrlKey ? 'Ctrl+' : ''}${event.altKey ? 'Alt+' : ''}${event.shiftKey ? 'Shift+' : ''}${name}`));
        return;
      }
      const taken = KEY_ACTIONS.find((action) => action !== capturing && draft[action] === combo);
      if (taken !== undefined) {
        setProblem(`${comboLabel(combo)} ya es la tecla de «${KEY_ACTION_LABELS[taken]}». Elige otra o cambia primero esa.`);
        return;
      }
      setDraft({ ...draft, [capturing]: combo });
      setProblem(null);
      setInfo(null);
      setCapturing(null);
    };
    window.addEventListener('keydown', capture, true);
    return () => window.removeEventListener('keydown', capture, true);
  }, [capturing, draft]);

  const hasChanges = KEY_ACTIONS.some((action) => draft[action] !== saved[action]);

  const save = (): void => {
    if (!isKeymap(draft)) {
      setProblem('Hay una tecla repetida o que no se puede usar.');
      return;
    }
    run(async () => {
      await toolsApi.saveKeymap(draft);
      onSaved(draft);
      setInfo('Atajos guardados. Ya funcionan en la pantalla de venta.');
    });
  };

  return (
    <section aria-label="Atajos de teclado">
      <p className="settings-help">
        Elige la tecla de cada acción: oprime «Cambiar» y luego la tecla nueva. Sirven F1 a F12, solas o con Ctrl, Alt o Mayús, y las letras con Ctrl o Alt. Enter, Esc, las flechas, + y − siguen
        haciendo lo de siempre en la venta.
      </p>
      <table className="keys-table">
        <thead>
          <tr>
            <th scope="col">Acción</th>
            <th scope="col">Tecla</th>
            <th scope="col">
              <span className="visually-hidden">Cambiar</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {KEY_ACTIONS.map((action) => (
            <tr key={action} data-changed={draft[action] !== DEFAULT_KEYMAP[action]}>
              <th scope="row">{KEY_ACTION_LABELS[action]}</th>
              <td>{capturing === action ? <em>Oprime la tecla nueva… (Esc para dejarla igual)</em> : <kbd>{comboLabel(draft[action])}</kbd>}</td>
              <td className="line-number">
                <button
                  type="button"
                  className="button button-small"
                  aria-label={`Cambiar la tecla de ${KEY_ACTION_LABELS[action]}`}
                  disabled={capturing !== null && capturing !== action}
                  onClick={() => {
                    setProblem(null);
                    setCapturing(capturing === action ? null : action);
                  }}
                >
                  {capturing === action ? 'Dejar igual' : 'Cambiar'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Message text={problem ?? message} />
      {info !== null && (
        <p className="notice notice-info" role="status">
          {info}
        </p>
      )}
      <div className="settings-actions">
        <button
          type="button"
          className="button"
          disabled={isBusy || capturing !== null}
          onClick={() => {
            setDraft(DEFAULT_KEYMAP);
            setProblem(null);
            setInfo(null);
          }}
        >
          Volver a las teclas de fábrica
        </button>
        <button type="button" className="button button-primary" disabled={isBusy || capturing !== null || !hasChanges} onClick={save}>
          Guardar atajos
        </button>
      </div>
    </section>
  );
}

function linesToText(lines: readonly string[]): string {
  return lines.join('\n');
}

function textToLines(text: string): string[] {
  return text
    .split('\n')
    .slice(0, MAX_TICKET_EXTRA_LINES)
    .map((line) => line.slice(0, 48));
}

function TicketTab({ toolsApi }: { readonly toolsApi: ToolsApi }): ReactElement {
  const [design, setDesign] = useState<TicketDesign | null>(null);
  const [preview, setPreview] = useState<readonly string[]>([]);
  const [info, setInfo] = useState<string | null>(null);
  const { isBusy, message, setMessage, run } = useAction();

  useEffect(() => {
    toolsApi.getTicketDesign().then(setDesign, () => setMessage('No se pudo leer el diseño del ticket.'));
  }, [toolsApi, setMessage]);

  // The sample follows every change, so the owner sees the ticket before saving it.
  useEffect(() => {
    if (design === null) {
      return;
    }
    let isCurrent = true;
    toolsApi.previewTicket(design).then(
      (lines) => {
        if (isCurrent) {
          setPreview(lines);
        }
      },
      () => undefined,
    );
    return () => {
      isCurrent = false;
    };
  }, [design, toolsApi]);

  if (design === null) {
    return <Message text={message} />;
  }
  const change = (patch: Partial<TicketDesign>): void => {
    setDesign({ ...design, ...patch });
    setInfo(null);
  };

  return (
    <section className="ticket-designer" aria-label="Diseño del ticket">
      <div className="ticket-options">
        <label className="payment-field">
          <span>Encabezado (bajo el nombre del negocio)</span>
          <textarea
            aria-label="Encabezado del ticket"
            rows={MAX_TICKET_EXTRA_LINES}
            value={linesToText(design.headerLines)}
            onChange={(event) => change({ headerLines: textToLines(event.target.value) })}
            placeholder={'Dirección\nTeléfono\nRFC'}
          />
          <small>Hasta {MAX_TICKET_EXTRA_LINES} renglones: dirección, teléfono, RFC.</small>
        </label>
        <label className="payment-field">
          <span>Pie del ticket</span>
          <textarea
            aria-label="Pie del ticket"
            rows={MAX_TICKET_EXTRA_LINES}
            value={linesToText(design.footerLines)}
            onChange={(event) => change({ footerLines: textToLines(event.target.value) })}
            placeholder={'Gracias por su compra\nCambios con ticket en 30 días'}
          />
          <small>Hasta {MAX_TICKET_EXTRA_LINES} renglones: agradecimiento, política de cambios, redes.</small>
        </label>
        <SelectField
          label="Ancho del papel"
          value={String(design.columns)}
          onChange={(value) => change({ columns: Number(value) as TicketColumns })}
          options={TICKET_COLUMN_CHOICES.map((columns) => ({ value: String(columns), label: PAPER_LABELS[columns] }))}
        />
        <SelectField
          label="Fuente"
          value={design.font}
          onChange={(value) => change({ font: value as TicketFont })}
          options={TICKET_FONT_CHOICES.map((font) => ({ value: font, label: FONT_LABELS[font] }))}
        />
        <SelectField
          label="Tamaño de letra"
          value={design.textSize}
          onChange={(value) => change({ textSize: value as TicketTextSize })}
          options={TICKET_TEXT_SIZE_CHOICES.map((size) => ({ value: size, label: TEXT_SIZE_LABELS[size] }))}
          hint={`Caben ${String(ticketLineWidth(design))} letras por renglón con este papel, fuente y tamaño.`}
        />
        <SelectField
          label="Copias por venta"
          value={String(design.copies)}
          onChange={(value) => change({ copies: Number(value) })}
          options={Array.from({ length: MAX_TICKET_COPIES }, (_, index) => ({ value: String(index + 1), label: index === 0 ? '1 ticket' : `${String(index + 1)} tickets` }))}
        />
        <CheckField label="Mostrar cantidad y precio unitario de cada producto" checked={design.showUnitPrice} onChange={(showUnitPrice) => change({ showUnitPrice })} />
        <CheckField label="Desglosar subtotal e IVA" checked={design.showTaxBreakdown} onChange={(showTaxBreakdown) => change({ showTaxBreakdown })} />
        <CheckField label="Total en letra grande" checked={design.bigTotal} onChange={(bigTotal) => change({ bigTotal })} />
        <Message text={message} />
        {info !== null && (
          <p className="notice notice-info" role="status">
            {info}
          </p>
        )}
        <div className="settings-actions">
          <button type="button" className="button" disabled={isBusy} onClick={() => change(DEFAULT_TICKET_DESIGN)}>
            Volver al ticket de fábrica
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={isBusy}
            onClick={() =>
              run(async () => {
                await toolsApi.saveTicketDesign(design);
                setInfo('Diseño guardado. El siguiente ticket ya sale así.');
              })
            }
          >
            Guardar diseño
          </button>
        </div>
      </div>
      <figure className="ticket-preview">
        <figcaption>Así sale el ticket</figcaption>
        <pre
          aria-label="Vista previa del ticket"
          data-columns={design.columns}
          data-font={design.font}
          data-size={design.textSize}
          style={{ fontSize: `${String(PREVIEW_LETTER_REM * (design.font === 'b' ? FONT_B_WIDTH : 1) * TEXT_SIZE_SCALE[design.textSize].width)}rem` }}
        >
          {preview.map((line, index) => (
            <Fragment key={index}>
              <span className="ticket-preview-line">{line}</span>
              {'\n'}
            </Fragment>
          ))}
        </pre>
      </figure>
    </section>
  );
}

function PrinterTab({ toolsApi }: { readonly toolsApi: ToolsApi }): ReactElement {
  const [share, setShare] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const { isBusy, message, setMessage, run } = useAction();

  useEffect(() => {
    toolsApi.getPrinter().then(setShare, () => setMessage('No se pudo leer la impresora.'));
  }, [toolsApi, setMessage]);

  const save = (): void =>
    run(async () => {
      const result = await toolsApi.savePrinter(share);
      if (result.status === 'invalid') {
        setMessage('Ese nombre no sirve. Escribe el nombre con el que Windows comparte la impresora, por ejemplo TM-T20.');
        return;
      }
      setShare(result.share);
      setInfo(result.share === '' ? 'La caja ya no imprime tickets. Puedes seguir vendiendo.' : `Impresora guardada: ${result.share}. Haz una impresión de prueba.`);
    });

  const test = (): void =>
    run(async () => {
      const result = await toolsApi.testPrint();
      if (result.status === 'printed') {
        setInfo('Se envió un ticket de prueba. Si no salió, revisa que la impresora esté encendida y con papel.');
      } else if (result.status === 'no_printer') {
        setMessage('Primero guarda el nombre de la impresora.');
      } else {
        setMessage(`No se pudo imprimir: ${result.message}`);
      }
    });

  return (
    <section aria-label="Impresora de tickets">
      <ol className="settings-steps">
        <li>Conecta la impresora de tickets e instálala en Windows.</li>
        <li>
          En Windows abre <strong>Impresoras y escáneres</strong>, elige la impresora, entra a <strong>Propiedades de impresora → Compartir</strong> y marca <strong>Compartir esta impresora</strong>
          con un nombre corto, por ejemplo <code>TM-T20</code>.
        </li>
        <li>Escribe aquí ese nombre y guarda. Después haz una impresión de prueba.</li>
      </ol>
      <Field
        label="Nombre compartido de la impresora"
        value={share}
        onChange={(value) => {
          setShare(value);
          setInfo(null);
        }}
        maxLength={120}
        onEnter={save}
        hint="Solo el nombre (TM-T20) si está en esta computadora, o \\\\otra-pc\\nombre si está en otra. Vacío: no imprimir."
      />
      <Message text={message} />
      {info !== null && (
        <p className="notice notice-info" role="status">
          {info}
        </p>
      )}
      <div className="settings-actions">
        <button type="button" className="button" disabled={isBusy} onClick={test}>
          Imprimir un ticket de prueba
        </button>
        <button type="button" className="button button-primary" disabled={isBusy} onClick={save}>
          Guardar impresora
        </button>
      </div>
    </section>
  );
}
