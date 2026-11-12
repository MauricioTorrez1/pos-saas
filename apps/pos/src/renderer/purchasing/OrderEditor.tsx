import { formatCents, parseQuantity } from '@pos-saas/money';
import { useEffect, useRef, useState, type ReactElement } from 'react';

import {
  formatFolio,
  type OrderCandidate,
  type OrderFileFormat,
  type PurchaseOrder,
  type PurchasingApi,
  type Supplier,
} from '../../shared/supplier-order';
import { formatQuantity, formatSaleMoment, unitLabel } from '../sale/format';
import { Field, Message, SelectField, useAction } from '../ui/form-parts';
import { useWindowKeys } from '../ui/use-window-keys';
import { describeRefusal, isOwnerRefusal, lineFromCandidate, lineFromSaved, quantityInputText, readLine, totalsOf, type DraftLine } from './order-form';

const MILLI_PER_UNIT = 1000;
const NOTES_LIMIT = 500;

const STALE = 'Este pedido cambió mientras lo editabas, así que no se guardó nada. Ya cargué cómo está ahora: revisa y vuelve a intentar.';

interface OrderEditorProps {
  readonly api: PurchasingApi;
  /** The owner needs no PIN, and a cashier has to type the one of an owner to save, send or export. */
  readonly isOwner: boolean;
  /** The active suppliers. */
  readonly suppliers: readonly Supplier[];
  /** The order to open, or null for a new one. */
  readonly orderId: string | null;
  readonly onManageSuppliers: () => void;
  /** Called to go back to the list. */
  readonly onBack: () => void;
}

/** What was typed in the box of a reorder level. */
interface LevelForm {
  readonly lineKey: string;
  readonly minimum: string;
  readonly maximum: string;
}

/**
 * The screen of one order to a supplier (E1-44): choose the supplier, add lines by name, barcode (the scanner types straight
 * into the box) or code of the supplier, set the quantities and the estimated costs, save it as a draft, mark it as sent, and
 * get an Excel or PDF file to mail or send by WhatsApp. It never changes the stock: the order is a document. A sent order is
 * read only. The suggestion by low stock is offered, never forced.
 *
 * @param props.api bridge of the purchase order
 * @param props.isOwner whether the person at the register is the owner
 * @param props.suppliers the suppliers that can be chosen
 * @param props.orderId the order to open, or null for a new one
 * @param props.onManageSuppliers opens the suppliers
 * @param props.onBack called to go back to the list
 * @returns the screen, to put inside a dialog
 */
export function OrderEditor({ api, isOwner, suppliers, orderId, onManageSuppliers, onBack }: OrderEditorProps): ReactElement {
  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<readonly DraftLine[]>([]);
  const [showProblems, setShowProblems] = useState(false);
  const [query, setQuery] = useState('');
  const [choices, setChoices] = useState<readonly OrderCandidate[]>([]);
  const [suggestions, setSuggestions] = useState<readonly OrderCandidate[] | null>(null);
  const [level, setLevel] = useState<LevelForm | null>(null);
  const [pin, setPin] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [savedFile, setSavedFile] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<'send' | 'discard' | null>(null);
  // Whether something was edited since the order was loaded or saved. Without edits, exporting or sending writes no new save.
  const [isDirty, setIsDirty] = useState(false);
  const { isBusy, message, setMessage, run } = useAction();
  const searchRef = useRef<HTMLInputElement>(null);

  const isSent = order?.status === 'sent';
  const supplierOptions = [...suppliers, ...(order !== null && !suppliers.some(({ id }) => id === order.supplierId) ? [{ id: order.supplierId, name: order.supplierName }] : [])];
  const totals = totalsOf(lines);

  const show = (loaded: PurchaseOrder): void => {
    setOrder(loaded);
    setSupplierId(loaded.supplierId);
    setNotes(loaded.notes ?? '');
    setLines(loaded.lines.map(lineFromSaved));
    setShowProblems(false);
    setConfirming(null);
    setIsDirty(false);
  };

  useEffect(() => {
    if (orderId === null) {
      return;
    }
    run(async () => {
      const loaded = await api.getOrder(orderId);
      if (loaded === null) {
        setMessage('El pedido ya no existe.');
        return;
      }
      show(loaded);
    });
    // The order is loaded once, when the screen opens.
  }, []);

  /** Called by every edit: it clears what the last action said, and marks the order as changed. */
  const touched = (): void => {
    setIsDirty(true);
    setNote(null);
    setMessage(null);
    setConfirming(null);
    setSavedFile(null);
  };

  const changeLine = (key: string, patch: Partial<DraftLine>): void => {
    touched();
    setLines((previous) => previous.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  /** Puts a product on the order. A product that is already there gets one more unit, so a scanner can count by scanning. */
  const addCandidate = (candidate: OrderCandidate, quantityMilli: number | null = null): void => {
    touched();
    setChoices([]);
    setLines((previous) => {
      const existing = previous.find((line) => line.productId === candidate.productId);
      if (existing === undefined) {
        return [...previous, lineFromCandidate(candidate, quantityMilli)];
      }
      return previous.map((line) => {
        if (line.key !== existing.key) {
          return line;
        }
        // A suggestion sets the quantity it asks for; a scan or a pick counts one more.
        const current = readLine(line);
        const milli = quantityMilli ?? (current.ok ? current.request.quantityMilli : 0) + MILLI_PER_UNIT;
        return { ...line, quantityText: quantityInputText(milli, line.unit) };
      });
    });
  };

  const search = (): void => {
    const text = query.trim();
    if (text === '' || isSent) {
      return;
    }
    run(async () => {
      const found = await api.searchOrderProducts({ supplierId: supplierId === '' ? null : supplierId, text });
      if (found.length === 0) {
        setChoices([]);
        setMessage(`No encontramos «${text}». Busca por nombre, código de barras o código del proveedor.`);
        return;
      }
      setQuery('');
      if (found.length === 1) {
        addCandidate(found[0]!);
        searchRef.current?.focus();
      } else {
        setChoices(found);
      }
    });
  };

  const suggest = (): void => {
    if (isSent || supplierId === '') {
      return;
    }
    run(async () => {
      setSuggestions(await api.suggestOrderProducts(supplierId));
    });
  };

  const ownerPin = isOwner ? {} : { ownerPin: pin };

  /** Checks what is needed before anything is asked of the main process. Returns what the person must fix, or null. */
  const problemBeforeSaving = (): string | null => {
    if (supplierId === '') {
      return 'Elige el proveedor del pedido.';
    }
    if (!lines.every((line) => readLine(line).ok)) {
      setShowProblems(true);
      return 'Revisa lo marcado en rojo.';
    }
    if (!isOwner && pin === '') {
      return 'Pídele al dueño que escriba su PIN.';
    }
    return null;
  };

  /** Saves the draft and answers the order as it is now, or null if nothing was written. */
  const saveDraft = async (): Promise<PurchaseOrder | null> => {
    if (order !== null && (isSent || !isDirty)) {
      return order;
    }
    const problem = problemBeforeSaving();
    if (problem !== null) {
      setMessage(problem);
      return null;
    }
    const requests = lines.map((line) => {
      const reading = readLine(line);
      return reading.ok ? reading.request : null;
    });
    const result = await api.saveOrder({
      ...(order === null ? {} : { orderId: order.id, expectedRevision: order.revision }),
      supplierId,
      notes: notes.trim() === '' ? null : notes,
      lines: requests.filter((request) => request !== null),
      ...ownerPin,
    });
    if (result.status === 'saved') {
      setOrder(result.order);
      setIsDirty(false);
      return result.order;
    }
    if (result.status === 'stale') {
      show(result.order);
      setMessage(STALE);
    } else if (result.status === 'not_found') {
      setMessage('El pedido ya no existe.');
    } else if (result.status === 'supplier_not_found') {
      setMessage('Ese proveedor ya no está disponible. Elige otro.');
    } else if (result.status === 'product_not_found') {
      setMessage('Uno de los productos ya no está en el catálogo. Quítalo del pedido.');
    } else if (isOwnerRefusal(result)) {
      setPin('');
      setMessage(describeRefusal(result));
    }
    return null;
  };

  const save = (): void => {
    if (isSent) {
      return;
    }
    run(async () => {
      const saved = await saveDraft();
      if (saved !== null) {
        setNote(`Borrador guardado: ${formatFolio(saved.folio)}. Puedes cerrarlo y seguir después.`);
      }
    });
  };

  const markSent = (): void => {
    if (isSent) {
      return;
    }
    if (lines.length === 0) {
      setMessage('Agrega al menos un renglón antes de marcarlo como enviado.');
      return;
    }
    if (confirming !== 'send') {
      const problem = problemBeforeSaving();
      setMessage(problem);
      setConfirming(problem === null ? 'send' : null);
      return;
    }
    run(async () => {
      const saved = await saveDraft();
      if (saved === null) {
        return;
      }
      const result = await api.markOrderSent({ orderId: saved.id, expectedRevision: saved.revision, ...ownerPin });
      setConfirming(null);
      if (result.status === 'sent') {
        show(result.order);
        setNote(`${formatFolio(result.order.folio)} quedó como enviado. Ya no se puede cambiar, y queda en el historial.`);
      } else if (result.status === 'already_sent' || result.status === 'stale') {
        show(result.order);
        setMessage(result.status === 'stale' ? STALE : 'Este pedido ya estaba enviado.');
      } else if (result.status === 'empty') {
        setMessage('Agrega al menos un renglón antes de marcarlo como enviado.');
      } else if (result.status === 'not_found') {
        setMessage('El pedido ya no existe.');
      } else {
        setPin('');
        setMessage(describeRefusal(result));
      }
    });
  };

  const discard = (): void => {
    if (isSent) {
      return;
    }
    if (order === null) {
      onBack();
      return;
    }
    if (confirming !== 'discard') {
      const problem = !isOwner && pin === '' ? 'Pídele al dueño que escriba su PIN.' : null;
      setMessage(problem);
      setConfirming(problem === null ? 'discard' : null);
      return;
    }
    run(async () => {
      const result = await api.discardOrder({ orderId: order.id, expectedRevision: order.revision, ...ownerPin });
      setConfirming(null);
      if (result.status === 'discarded' || result.status === 'not_found') {
        onBack();
      } else if (result.status === 'stale' || result.status === 'already_sent') {
        show(result.order);
        setMessage(result.status === 'stale' ? STALE : 'Este pedido ya estaba enviado y no se puede descartar.');
      } else {
        setPin('');
        setMessage(describeRefusal(result));
      }
    });
  };

  const exportAs = (format: OrderFileFormat): void =>
    run(async () => {
      if (lines.length === 0) {
        setMessage('Agrega al menos un renglón para sacar el archivo.');
        return;
      }
      const saved = await saveDraft();
      if (saved === null) {
        return;
      }
      const result = await api.exportOrder({ orderId: saved.id, format, ...ownerPin });
      if (result.status === 'saved') {
        setSavedFile(result.path);
        setNote(`Archivo guardado en ${result.path}. Ya lo puedes mandar por correo o por WhatsApp.`);
      } else if (result.status === 'cancelled') {
        setNote('No se guardó el archivo.');
      } else if (result.status === 'failed') {
        setMessage(`No se pudo guardar el archivo: ${result.message}`);
      } else if (result.status === 'not_found') {
        setMessage('El pedido ya no existe.');
      } else {
        setPin('');
        setMessage(describeRefusal(result));
      }
    });

  const revealFile = (): void => {
    if (savedFile !== null) {
      api.revealFile(savedFile).catch(() => setMessage('No se pudo abrir la carpeta.'));
    }
  };

  const saveLevel = (): void => {
    if (level === null) {
      return;
    }
    const line = lines.find(({ key }) => key === level.lineKey);
    if (line === undefined) {
      return;
    }
    let minimumMilli: number;
    let maximumMilli: number | null = null;
    try {
      minimumMilli = parseQuantity(level.minimum.trim(), line.unit).milli;
      if (level.maximum.trim() !== '') {
        maximumMilli = parseQuantity(level.maximum.trim(), line.unit).milli;
      }
    } catch {
      setMessage('El mínimo y el máximo llevan solo números, con hasta 3 decimales (las piezas son enteras).');
      return;
    }
    if (minimumMilli <= 0 || (maximumMilli !== null && maximumMilli <= minimumMilli)) {
      setMessage('El mínimo debe ser mayor que cero, y «Pedir hasta» mayor que el mínimo.');
      return;
    }
    if (!isOwner && pin === '') {
      setMessage('Pídele al dueño que escriba su PIN.');
      return;
    }
    run(async () => {
      const result = await api.setReorderLevel({ productId: line.productId, minimumMilli, maximumMilli, ...ownerPin });
      if (result.status === 'saved') {
        const { candidate } = result;
        changeLine(line.key, { stockMilli: candidate.stockMilli, minimumMilli: candidate.minimumMilli, maximumMilli: candidate.maximumMilli, suggestedMilli: candidate.suggestedMilli });
        setLevel(null);
        setNote(`Listo. Cuando ${line.description} baje de ${quantityInputText(minimumMilli, line.unit)} ${unitLabel(line.unit)}, la caja lo va a sugerir.`);
      } else if (result.status === 'product_not_found') {
        setMessage('El producto ya no está en el catálogo.');
      } else {
        setPin('');
        setMessage(describeRefusal(result));
      }
    });
  };

  const isPaused = isBusy || level !== null;
  useWindowKeys(
    {
      F2: isSent ? undefined : save,
      F4: isSent ? undefined : markSent,
      F5: () => exportAs('xlsx'),
      F6: () => exportAs('pdf'),
      F7: isSent ? undefined : suggest,
      F8: isSent ? undefined : discard,
      F9: savedFile === null ? undefined : revealFile,
      Escape: () => (confirming !== null ? setConfirming(null) : onBack()),
    },
    isPaused,
  );

  const title = order === null ? 'Pedido nuevo' : `Pedido ${formatFolio(order.folio)} · ${isSent ? 'Enviado' : 'Borrador'}`;

  return (
    <>
      <h2 id="order-title">{title}</h2>
      {isSent && order !== null && (
        <p className="notice notice-info" role="status">
          Enviado el {formatSaleMoment(order.sentAt ?? order.updatedAt)}. Ya no se puede cambiar. Puedes sacar el archivo otra vez.
        </p>
      )}
      {suppliers.length === 0 && order === null ? (
        <p className="notice" role="alert">
          Primero da de alta un proveedor.{' '}
          <button type="button" className="button" tabIndex={-1} onClick={onManageSuppliers}>
            Proveedores
          </button>
        </p>
      ) : (
        <SelectField
          label="Proveedor"
          value={supplierId}
          onChange={(value) => {
            touched();
            setSupplierId(value);
          }}
          options={supplierOptions.map(({ id, name }) => ({ value: id, label: name }))}
          disabled={isSent || lines.length > 0}
          hint={lines.length > 0 && !isSent ? 'Para cambiar de proveedor, quita los renglones o haz otro pedido.' : undefined}
        />
      )}
      {!isSent && (
        <label className="payment-field">
          <span>Buscar producto (nombre, código de barras o código del proveedor)</span>
          <input
            ref={searchRef}
            aria-label="Buscar producto para el pedido"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            maxLength={100}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setMessage(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                search();
              }
            }}
          />
          <small>El lector de códigos escribe aquí directo: cada lectura agrega el producto, y si ya está suma una pieza.</small>
        </label>
      )}
      {choices.length > 0 && (
        <ul className="cash-actions" aria-label="Productos encontrados">
          {choices.map((choice) => (
            <li key={choice.productId}>
              <button type="button" className="button" disabled={isBusy} onClick={() => addCandidate(choice)}>
                {choice.name}
                {choice.supplierCodes[0] === undefined ? '' : ` · ${choice.supplierCodes[0].supplierCode}`}
                {` · existencia ${formatQuantity({ milli: Math.max(choice.stockMilli, 0), unit: choice.unit })}`}
              </button>
            </li>
          ))}
        </ul>
      )}
      {suggestions !== null && !isSent && (
        <section className="order-suggestions" aria-label="Sugerencias por existencia baja">
          {suggestions.length === 0 ? (
            <p>
              Ningún producto con mínimo está bajo. Para que la caja avise, captura el mínimo de un producto con el botón «Mínimo» de su renglón.
            </p>
          ) : (
            <>
              <p>
                <strong>Productos bajos de existencia.</strong> Agrégalos con la cantidad sugerida, que luego puedes cambiar.
              </p>
              <ul className="cash-actions">
                {suggestions.map((candidate) => (
                  <li key={candidate.productId}>
                    <button type="button" className="button" disabled={isBusy} onClick={() => addCandidate(candidate, candidate.suggestedMilli)}>
                      Agregar {candidate.name}: pedir {formatQuantity({ milli: candidate.suggestedMilli ?? 0, unit: candidate.unit })} (hay{' '}
                      {formatQuantity({ milli: Math.max(candidate.stockMilli, 0), unit: candidate.unit })}, mínimo {formatQuantity({ milli: candidate.minimumMilli ?? 0, unit: candidate.unit })})
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {lines.length === 0 ? (
        <p className="order-empty">Todavía no hay renglones. Busca un producto, escanea su código o usa las sugerencias (F7).</p>
      ) : (
        <table className="order-lines" aria-label="Renglones del pedido">
          <thead>
            <tr>
              <th scope="col">Código del proveedor</th>
              <th scope="col">Producto</th>
              <th scope="col">Cantidad</th>
              <th scope="col">Costo estimado</th>
              <th scope="col">Importe</th>
              {!isSent && <th scope="col">Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <LineRow
                key={line.key}
                line={line}
                isReadOnly={isSent}
                showProblems={showProblems}
                isBusy={isBusy}
                onChange={(patch) => changeLine(line.key, patch)}
                onRemove={() => {
                  touched();
                  setLines((previous) => previous.filter(({ key }) => key !== line.key));
                }}
                onSetLevel={() => setLevel({ lineKey: line.key, minimum: line.minimumMilli === null ? '' : quantityInputText(line.minimumMilli, line.unit), maximum: line.maximumMilli === null ? '' : quantityInputText(line.maximumMilli, line.unit) })}
              />
            ))}
          </tbody>
        </table>
      )}
      {level !== null && (
        <section className="order-level" aria-label="Mínimo del producto">
          <p>
            <strong>Mínimo de {lines.find(({ key }) => key === level.lineKey)?.description}.</strong> Cuando la existencia baje de ahí, la caja lo sugiere en un pedido.
          </p>
          <Field label="Mínimo" value={level.minimum} onChange={(minimum) => setLevel({ ...level, minimum })} autoFocus maxLength={12} />
          <Field label="Pedir hasta (opcional)" value={level.maximum} onChange={(maximum) => setLevel({ ...level, maximum })} maxLength={12} onEnter={saveLevel} hint="Sin esto, se sugiere llegar al doble del mínimo." />
          <div className="payment-actions">
            <button type="button" className="button" tabIndex={-1} onClick={() => setLevel(null)}>
              Cancelar
            </button>
            <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={saveLevel}>
              Guardar mínimo
            </button>
          </div>
        </section>
      )}
      <p className="order-total" role="status" aria-label="Total estimado del pedido">
        Total estimado: <strong>{formatCents(totals.totalCents)}</strong>
        {totals.linesWithoutCost > 0 && ` · ${totals.linesWithoutCost} renglón(es) sin costo no suman`}
      </p>
      <label className="payment-field">
        <span>Notas para el proveedor (opcional)</span>
        <input aria-label="Notas del pedido" value={notes} maxLength={NOTES_LIMIT} disabled={isSent} onChange={(event) => { touched(); setNotes(event.target.value); }} />
      </label>
      {!isOwner && <Field label="PIN del dueño" value={pin} onChange={setPin} type="password" maxLength={8} />}
      {confirming === 'send' && (
        <p className="notice" role="alert">
          ¿Marcar como enviado? Ya no se podrá cambiar, y queda en el historial. Oprime F4 otra vez para confirmar, o Esc para cancelar.
        </p>
      )}
      {confirming === 'discard' && (
        <p className="notice" role="alert">
          ¿Descartar este borrador? Se borra. Oprime F8 otra vez para confirmar, o Esc para cancelar.
        </p>
      )}
      {note !== null && (
        <p className="notice notice-info" role="status">
          {note}
        </p>
      )}
      <Message text={message} />
      <div className="payment-actions order-actions">
        <button type="button" className="button" tabIndex={-1} onClick={onBack}>
          Volver <kbd>Esc</kbd>
        </button>
        {!isSent && (
          <button type="button" className="button" tabIndex={-1} onClick={suggest}>
            Sugerir <kbd>F7</kbd>
          </button>
        )}
        <button type="button" className="button" tabIndex={-1} disabled={isBusy} onClick={() => exportAs('xlsx')}>
          Excel <kbd>F5</kbd>
        </button>
        <button type="button" className="button" tabIndex={-1} disabled={isBusy} onClick={() => exportAs('pdf')}>
          PDF <kbd>F6</kbd>
        </button>
        {savedFile !== null && (
          <button type="button" className="button" tabIndex={-1} onClick={revealFile}>
            Abrir carpeta <kbd>F9</kbd>
          </button>
        )}
        {!isSent && order !== null && (
          <button type="button" className="button" tabIndex={-1} disabled={isBusy} onClick={discard}>
            Descartar <kbd>F8</kbd>
          </button>
        )}
        {!isSent && (
          <button type="button" className="button" tabIndex={-1} disabled={isBusy} onClick={save}>
            Guardar borrador <kbd>F2</kbd>
          </button>
        )}
        {!isSent && (
          <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={markSent}>
            Marcar como enviado <kbd>F4</kbd>
          </button>
        )}
      </div>
    </>
  );
}

interface LineRowProps {
  readonly line: DraftLine;
  readonly isReadOnly: boolean;
  readonly showProblems: boolean;
  readonly isBusy: boolean;
  readonly onChange: (patch: Partial<DraftLine>) => void;
  readonly onRemove: () => void;
  readonly onSetLevel: () => void;
}

function LineRow({ line, isReadOnly, showProblems, isBusy, onChange, onRemove, onSetLevel }: LineRowProps): ReactElement {
  const reading = readLine(line);
  const quantityProblem = !reading.ok && showProblems ? reading.quantityProblem : undefined;
  const costProblem = !reading.ok && showProblems ? reading.costProblem : undefined;
  const hasStock = line.stockMilli !== null;
  const suggestedText = line.suggestedMilli === null ? null : quantityInputText(line.suggestedMilli, line.unit);
  return (
    <tr>
      <td>
        {isReadOnly || line.supplierCodes.length <= 1 ? (
          (line.supplierCode ?? '—')
        ) : (
          <select
            aria-label={`Código del proveedor de ${line.description}`}
            className="order-input"
            value={line.supplierCode ?? ''}
            onChange={(event) => onChange({ supplierCode: event.target.value === '' ? null : event.target.value })}
          >
            {line.supplierCodes.map(({ supplierCode, purchaseUnit }) => (
              <option key={supplierCode} value={supplierCode}>
                {supplierCode}
                {purchaseUnit === null ? '' : ` (${purchaseUnit})`}
              </option>
            ))}
          </select>
        )}
      </td>
      <td>
        {line.description}
        <small>
          {line.barcode ?? 'Sin código de barras'}
          {hasStock && line.stockMilli !== null ? ` · Hay ${line.stockMilli < 0 ? `−${formatQuantity({ milli: -line.stockMilli, unit: line.unit })}` : formatQuantity({ milli: line.stockMilli, unit: line.unit })}` : ''}
          {line.minimumMilli !== null ? ` · Mínimo ${quantityInputText(line.minimumMilli, line.unit)}` : ''}
        </small>
        {suggestedText !== null && suggestedText !== line.quantityText.trim() && !isReadOnly && <small>Sugerido: {suggestedText}</small>}
      </td>
      <td>
        {isReadOnly ? (
          `${line.quantityText} ${unitLabel(line.unit)}`
        ) : (
          <>
            <input
              className="order-input"
              aria-label={`Cantidad de ${line.description}`}
              aria-invalid={quantityProblem === undefined ? undefined : true}
              inputMode="decimal"
              autoComplete="off"
              maxLength={12}
              value={line.quantityText}
              onChange={(event) => onChange({ quantityText: event.target.value })}
            />{' '}
            {unitLabel(line.unit)}
            {quantityProblem !== undefined && <small className="payment-field-problem">{quantityProblem}</small>}
          </>
        )}
      </td>
      <td>
        {isReadOnly ? (
          line.costText === '' ? (
            '—'
          ) : (
            `$${line.costText}`
          )
        ) : (
          <>
            <input
              className="order-input"
              aria-label={`Costo estimado de ${line.description}`}
              aria-invalid={costProblem === undefined ? undefined : true}
              inputMode="decimal"
              autoComplete="off"
              maxLength={16}
              placeholder="Sin costo"
              value={line.costText}
              onChange={(event) => onChange({ costText: event.target.value })}
            />
            {costProblem !== undefined && <small className="payment-field-problem">{costProblem}</small>}
          </>
        )}
      </td>
      <td className="order-amount">{reading.ok && reading.totalCents !== null ? formatCents(reading.totalCents) : '—'}</td>
      {!isReadOnly && (
        <td>
          <button type="button" className="button" tabIndex={-1} disabled={isBusy} aria-label={`Quitar ${line.description}`} onClick={onRemove}>
            Quitar
          </button>{' '}
          <button type="button" className="button" tabIndex={-1} disabled={isBusy} aria-label={`Mínimo de ${line.description}`} onClick={onSetLevel}>
            Mínimo
          </button>
        </td>
      )}
    </tr>
  );
}
