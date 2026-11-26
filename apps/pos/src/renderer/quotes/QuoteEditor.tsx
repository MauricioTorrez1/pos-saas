import { formatCents, formatUnitPriceE4, lineTotals, MoneyError, parseQuantity, saleTotals, type Quantity } from '@pos-saas/money';
import { useRef, useState, type KeyboardEvent, type ReactElement } from 'react';

import { MAX_LOOKUP_TEXT_LENGTH, type CatalogProduct, type PosApi } from '../../shared/pos-api';
import {
  addDays,
  localDay,
  MAX_QUOTE_CUSTOMER_NAME,
  MAX_QUOTE_CUSTOMER_PHONE,
  MAX_QUOTE_NOTES,
  QUOTE_VALIDITY_DAYS,
  type Quote,
  type QuotesApi,
} from '../../shared/quotes';
import { Field, Message, useAction } from '../ui/form-parts';
import { unitLabel } from '../sale/format';

const MILLI_PER_UNIT = 1000;
const SEARCH_LIMIT = 8;

/** A product of the quote being written. */
interface EditorLine {
  readonly product: CatalogProduct;
  /** What the person typed for the quantity, in the unit of the product. */
  readonly quantityText: string;
  /** The price the line shows: the quoted one for a line the quote already had, the catalog's for a new one. */
  readonly priceE4: number;
}

/** Whether the editor starts empty, edits an open quote, or copies another one. */
export type QuoteEditorMode = { readonly kind: 'new' } | { readonly kind: 'edit'; readonly quote: Quote } | { readonly kind: 'duplicate'; readonly quote: Quote };

interface QuoteEditorProps {
  readonly posApi: Pick<PosApi, 'findProductByCode' | 'searchProducts'>;
  readonly quotesApi: Pick<QuotesApi, 'save'>;
  readonly mode: QuoteEditorMode;
  readonly onSaved: (quote: Quote) => void;
  readonly onCancel: () => void;
}

function readQuantity(text: string, product: CatalogProduct): Quantity | null {
  try {
    const quantity = parseQuantity(text.trim(), product.unit);
    return quantity.milli > 0 && (product.unit !== 'piece' || quantity.milli % MILLI_PER_UNIT === 0) ? quantity : null;
  } catch {
    return null;
  }
}

function quantityText(milli: number, product: CatalogProduct): string {
  return product.unit === 'piece' ? String(milli / MILLI_PER_UNIT) : (milli / MILLI_PER_UNIT).toFixed(3);
}

function initialLines(mode: QuoteEditorMode): EditorLine[] {
  if (mode.kind === 'new') {
    return [];
  }
  return mode.quote.lines.map((line) => {
    const product: CatalogProduct = { id: line.productId, name: line.productName, unit: line.quantity.unit, unitPriceE4: line.currentPriceE4 ?? line.unitPriceE4, taxRate: line.taxRate };
    // A copy is quoted again at today's prices; an edit of a valid quote keeps what the customer was told.
    const keepsPrice = mode.kind === 'edit' && mode.quote.status === 'draft';
    return { product, quantityText: quantityText(line.quantity.milli, product), priceE4: keepsPrice ? line.unitPriceE4 : product.unitPriceE4 };
  });
}

/**
 * Writes a quote: the customer (optional), the products by scanning or by name, how much of each, the last day the
 * prices hold (fifteen days by default) and notes. The register prices it when it is saved, so what is shown here is a
 * preview of the total.
 *
 * @param props.posApi looks products up
 * @param props.quotesApi saves the quote
 * @param props.mode a new quote, an edit or a copy
 * @param props.onSaved called with the quote as it was saved
 * @param props.onCancel goes back without saving
 * @returns the form
 */
export function QuoteEditor({ posApi, quotesApi, mode, onSaved, onCancel }: QuoteEditorProps): ReactElement {
  const source = mode.kind === 'new' ? null : mode.quote;
  const [customerName, setCustomerName] = useState(source?.customerName ?? '');
  const [customerPhone, setCustomerPhone] = useState(source?.customerPhone ?? '');
  const [notes, setNotes] = useState(source?.notes ?? '');
  const today = localDay(new Date());
  const [validUntil, setValidUntil] = useState(mode.kind === 'edit' && mode.quote.validUntil >= today ? mode.quote.validUntil : addDays(today, QUOTE_VALIDITY_DAYS));
  const [lines, setLines] = useState<EditorLine[]>(() => initialLines(mode));
  const [results, setResults] = useState<CatalogProduct[]>([]);
  const [lookupNotice, setLookupNotice] = useState<string | null>(null);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const lookupRef = useRef<HTMLInputElement>(null);
  const { isBusy, message, setMessage, run } = useAction();

  const addProduct = (product: CatalogProduct): void => {
    setLines((current) =>
      current.some((line) => line.product.id === product.id)
        ? current.map((line) => {
            const quantity = readQuantity(line.quantityText, line.product);
            return line.product.id === product.id && quantity !== null && product.unit === 'piece' ? { ...line, quantityText: quantityText(quantity.milli + MILLI_PER_UNIT, product) } : line;
          })
        : [...current, { product, quantityText: '1', priceE4: product.unitPriceE4 }],
    );
    setResults([]);
    setLookupNotice(null);
    if (lookupRef.current !== null) {
      lookupRef.current.value = '';
      lookupRef.current.focus();
    }
  };

  const lookUp = async (): Promise<void> => {
    const text = lookupRef.current?.value.trim() ?? '';
    if (text === '') {
      return;
    }
    try {
      const byCode = await posApi.findProductByCode(text);
      if (byCode !== null) {
        addProduct(byCode);
        return;
      }
      const found = await posApi.searchProducts(text);
      setResults(found.slice(0, SEARCH_LIMIT));
      setLookupNotice(found.length === 0 ? `No encontramos «${text}». Revisa el código o busca por nombre.` : null);
    } catch {
      setLookupNotice('No se pudo consultar el catálogo. Intenta de nuevo.');
    }
  };

  const handleLookupKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (results.length === 1 && results[0] !== undefined) {
        addProduct(results[0]);
      } else {
        void lookUp();
      }
    }
  };

  const setQuantity = (productId: string, text: string): void => {
    setLines((current) => current.map((line) => (line.product.id === productId ? { ...line, quantityText: text } : line)));
  };

  const removeLine = (productId: string): void => {
    setLines((current) => current.filter((line) => line.product.id !== productId));
  };

  const priced = lines.map((line) => {
    const quantity = readQuantity(line.quantityText, line.product);
    try {
      return { line, quantity, totals: quantity === null ? null : lineTotals(line.priceE4, quantity, line.product.taxRate) };
    } catch (error) {
      if (error instanceof MoneyError) {
        return { line, quantity: null, totals: null };
      }
      throw error;
    }
  });
  const hasBadQuantity = priced.some((entry) => entry.totals === null);
  const totalCents = hasBadQuantity ? null : saleTotals(priced.map((entry) => entry.totals!)).totalCents;

  const save = (): void => {
    if (lines.length === 0) {
      setMessage('Agrega al menos un producto a la cotización.');
      return;
    }
    if (hasBadQuantity) {
      setMessage('Revisa las cantidades: las piezas van en números enteros y todo debe ser mayor que cero.');
      return;
    }
    run(async () => {
      const result = await quotesApi.save({
        quoteId: mode.kind === 'edit' ? mode.quote.id : null,
        idempotencyKey,
        customerName: customerName.trim() === '' ? null : customerName,
        customerPhone: customerPhone.trim() === '' ? null : customerPhone,
        notes: notes.trim() === '' ? null : notes,
        validUntil,
        lines: priced.map(({ line, quantity }) => ({ productId: line.product.id, quantityMilli: quantity!.milli })),
        duplicatedFrom: mode.kind === 'duplicate' ? mode.quote.id : null,
      });
      if (result.status === 'saved') {
        onSaved(result.quote);
      } else if (result.status === 'invalid') {
        setMessage(result.message);
      } else {
        setMessage('Esta cotización ya se vendió o se canceló, y ya no se puede cambiar.');
      }
    });
  };

  const title = mode.kind === 'edit' ? `Editar ${mode.quote.folio}` : mode.kind === 'duplicate' ? `Copia de ${mode.quote.folio}` : 'Nueva cotización';

  return (
    <section className="quote-editor" aria-label={title}>
      <h3>{title}</h3>
      {mode.kind === 'duplicate' && <p className="dialog-hint">La copia toma los precios de hoy.</p>}
      {mode.kind === 'edit' && mode.quote.status === 'expired' && <p className="dialog-hint">Esta cotización venció: al guardarla se cotiza otra vez con los precios de hoy.</p>}
      <div className="quote-form-row">
        <Field label="Cliente (opcional)" value={customerName} onChange={setCustomerName} maxLength={MAX_QUOTE_CUSTOMER_NAME} />
        <Field label="Teléfono (opcional)" value={customerPhone} onChange={setCustomerPhone} maxLength={MAX_QUOTE_CUSTOMER_PHONE} />
        <label className="date-field">
          <span>Válida hasta</span>
          <input type="date" aria-label="Válida hasta" value={validUntil} min={today} max={addDays(today, 365)} onChange={(event) => setValidUntil(event.target.value)} />
        </label>
      </div>
      <label className="payment-field">
        <span>Agregar producto</span>
        <input
          ref={lookupRef}
          aria-label="Agregar producto a la cotización"
          type="text"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          maxLength={MAX_LOOKUP_TEXT_LENGTH}
          placeholder="Escanea el código o escribe el nombre y pulsa Enter"
          onKeyDown={handleLookupKey}
        />
      </label>
      {lookupNotice !== null && (
        <p className="notice" role="alert">
          {lookupNotice}
        </p>
      )}
      {results.length > 0 && (
        <ul className="quote-results" aria-label="Productos encontrados">
          {results.map((product) => (
            <li key={product.id}>
              <button type="button" className="button" onClick={() => addProduct(product)}>
                {product.name} · {formatUnitPriceE4(product.unitPriceE4)} / {unitLabel(product.unit)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {lines.length === 0 ? (
        <p className="empty-state">Todavía no hay productos en la cotización.</p>
      ) : (
        <table className="order-lines quote-lines">
          <thead>
            <tr>
              <th scope="col">Producto</th>
              <th scope="col">Cantidad</th>
              <th scope="col">Precio</th>
              <th scope="col">Importe</th>
              <th scope="col">
                <span className="visually-hidden">Quitar</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {priced.map(({ line, totals }) => (
              <tr key={line.product.id}>
                <td>{line.product.name}</td>
                <td>
                  <input
                    className="quote-quantity"
                    aria-label={`Cantidad de ${line.product.name}`}
                    inputMode="decimal"
                    value={line.quantityText}
                    aria-invalid={totals === null ? true : undefined}
                    onChange={(event) => setQuantity(line.product.id, event.target.value.replace(/[^\d.]/gu, ''))}
                  />{' '}
                  {unitLabel(line.product.unit)}
                </td>
                <td>{formatUnitPriceE4(line.priceE4)}</td>
                <td>{totals === null ? '—' : formatCents(totals.totalCents)}</td>
                <td>
                  <button type="button" className="button" aria-label={`Quitar ${line.product.name}`} onClick={() => removeLine(line.product.id)}>
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="quote-total" role="status" aria-label="Total de la cotización">
        {totalCents === null ? 'Revisa las cantidades' : `Total ${formatCents(totalCents)}`}
      </p>
      <label className="payment-field">
        <span>Notas (opcional)</span>
        <textarea aria-label="Notas de la cotización" value={notes} maxLength={MAX_QUOTE_NOTES} rows={2} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <Message text={message} />
      <div className="order-actions">
        <button type="button" className="button" disabled={isBusy} onClick={onCancel}>
          Volver
        </button>
        <button type="button" className="button button-primary" disabled={isBusy} onClick={save}>
          Guardar cotización
        </button>
      </div>
    </section>
  );
}

