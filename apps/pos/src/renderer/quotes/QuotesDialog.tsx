import { formatCents, formatUnitPriceE4 } from '@pos-saas/money';
import { useCallback, useEffect, useState, type ReactElement } from 'react';

import type { UserSummary } from '../../shared/auth';
import type { PosApi } from '../../shared/pos-api';
import {
  QUOTE_FILTER_LABELS,
  QUOTE_STATUS_FILTERS,
  QUOTE_STATUS_LABELS,
  QUOTE_VALIDITY_DAYS,
  quoteDayLabel,
  type PrepareConversionResult,
  type Quote,
  type QuotesApi,
  type QuoteStatus,
  type QuoteStatusFilter,
  type QuoteSummary,
} from '../../shared/quotes';
import { formatQuantity, formatSaleMoment } from '../sale/format';
import { Field, Message, SelectField, useAction } from '../ui/form-parts';
import { Modal } from '../ui/Modal';
import { QuoteEditor, type QuoteEditorMode } from './QuoteEditor';

/** A quote ready to be rung up at the register. */
export type ReadyQuote = Extract<PrepareConversionResult, { status: 'ready' }>;

/** What each step of the history says: a quote is created as a draft, which the list calls «Vigente». */
const EVENT_LABELS: Readonly<Record<QuoteStatus, string>> = { draft: 'Creada', converted: 'Vendida', cancelled: 'Cancelada' };

type View = { readonly kind: 'list' } | { readonly kind: 'detail'; readonly quoteId: string } | { readonly kind: 'editor'; readonly mode: QuoteEditorMode };

interface QuotesDialogProps {
  readonly posApi: Pick<PosApi, 'findProductByCode' | 'searchProducts'>;
  readonly quotesApi: QuotesApi;
  readonly user: UserSummary;
  /** Takes a quote to the register to be charged. */
  readonly onConvert: (quote: ReadyQuote) => void;
  readonly onClose: () => void;
}

/**
 * The panel of the quotes (F2-07): the list with its search, a quote with its history, and the editor. From a quote the
 * person edits it while it is open, copies it, prints it on the ticket printer, cancels it, or takes it to the register.
 *
 * @param props.posApi looks products up for the editor
 * @param props.quotesApi the bridge of the quotes
 * @param props.user who is signed in, to know when cancelling needs the PIN of an owner
 * @param props.onConvert takes a quote to the register
 * @param props.onClose closes the panel
 * @returns the dialog
 */
export function QuotesDialog({ posApi, quotesApi, user, onConvert, onClose }: QuotesDialogProps): ReactElement {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [info, setInfo] = useState<string | null>(null);

  const showQuote = (quote: Quote, text: string): void => {
    setInfo(text);
    setView({ kind: 'detail', quoteId: quote.id });
  };

  return (
    <Modal title="Cotizaciones" className="quotes" onClose={view.kind === 'list' ? onClose : () => setView({ kind: 'list' })}>
      {info !== null && (
        <p className="notice notice-info" role="status">
          {info}
        </p>
      )}
      {view.kind === 'list' && (
        <QuoteList
          quotesApi={quotesApi}
          onNew={() => {
            setInfo(null);
            setView({ kind: 'editor', mode: { kind: 'new' } });
          }}
          onOpen={(quoteId) => {
            setInfo(null);
            setView({ kind: 'detail', quoteId });
          }}
        />
      )}
      {view.kind === 'editor' && (
        <QuoteEditor
          posApi={posApi}
          quotesApi={quotesApi}
          mode={view.mode}
          onSaved={(quote) => showQuote(quote, `Cotización ${quote.folio} guardada. Puedes imprimirla o venderla.`)}
          onCancel={() => setView(view.mode.kind === 'new' ? { kind: 'list' } : { kind: 'detail', quoteId: view.mode.quote.id })}
        />
      )}
      {view.kind === 'detail' && (
        <QuoteDetail
          quotesApi={quotesApi}
          quoteId={view.quoteId}
          user={user}
          onBack={() => {
            setInfo(null);
            setView({ kind: 'list' });
          }}
          onEdit={(quote) => {
            setInfo(null);
            setView({ kind: 'editor', mode: { kind: 'edit', quote } });
          }}
          onDuplicate={(quote) => {
            setInfo(null);
            setView({ kind: 'editor', mode: { kind: 'duplicate', quote } });
          }}
          onInfo={setInfo}
          onConvert={onConvert}
        />
      )}
    </Modal>
  );
}

interface QuoteListProps {
  readonly quotesApi: Pick<QuotesApi, 'list'>;
  readonly onNew: () => void;
  readonly onOpen: (quoteId: string) => void;
}

function QuoteList({ quotesApi, onNew, onOpen }: QuoteListProps): ReactElement {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<QuoteStatusFilter>('all');
  const [quotes, setQuotes] = useState<QuoteSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    quotesApi.list({ text, status }).then(
      (found) => {
        if (isCurrent) {
          setQuotes(found);
          setFailed(false);
        }
      },
      () => setFailed(true),
    );
    return () => {
      isCurrent = false;
    };
  }, [quotesApi, text, status]);

  return (
    <section className="quote-list" aria-label="Lista de cotizaciones">
      <div className="quote-toolbar">
        <Field label="Buscar por folio, cliente, teléfono o producto" value={text} onChange={setText} autoFocus maxLength={100} />
        <SelectField label="Estado" value={status} onChange={setStatus} options={QUOTE_STATUS_FILTERS.map((filter) => ({ value: filter, label: QUOTE_FILTER_LABELS[filter] }))} />
        <button type="button" className="button button-primary" onClick={onNew}>
          Nueva cotización
        </button>
      </div>
      <p className="dialog-hint">Una cotización no es una venta: no descuenta existencias ni entra al corte. Vale {QUOTE_VALIDITY_DAYS} días si no eliges otra fecha.</p>
      <Message text={failed ? 'No se pudieron leer las cotizaciones. Intenta de nuevo.' : null} />
      {quotes !== null && quotes.length === 0 && <p className="empty-state">{text === '' && status === 'all' ? 'Todavía no hay cotizaciones.' : 'Ninguna cotización coincide con la búsqueda.'}</p>}
      {quotes !== null && quotes.length > 0 && (
        <table className="order-lines quote-table">
          <thead>
            <tr>
              <th scope="col">Folio</th>
              <th scope="col">Cliente</th>
              <th scope="col">Fecha</th>
              <th scope="col">Válida hasta</th>
              <th scope="col">Estado</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {quotes.map((quote) => (
              <tr key={quote.id}>
                <td>
                  <button type="button" className="link-button" onClick={() => onOpen(quote.id)}>
                    {quote.folio}
                  </button>
                </td>
                <td>{quote.customerName ?? 'Sin nombre'}</td>
                <td>{formatSaleMoment(quote.createdAt)}</td>
                <td>{quoteDayLabel(quote.validUntil)}</td>
                <td>
                  <span className="badge" data-tone={quote.status}>
                    {QUOTE_STATUS_LABELS[quote.status]}
                  </span>
                </td>
                <td>{formatCents(quote.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

interface QuoteDetailProps {
  readonly quotesApi: QuotesApi;
  readonly quoteId: string;
  readonly user: UserSummary;
  readonly onBack: () => void;
  readonly onEdit: (quote: Quote) => void;
  readonly onDuplicate: (quote: Quote) => void;
  readonly onInfo: (text: string | null) => void;
  readonly onConvert: (quote: ReadyQuote) => void;
}

function QuoteDetail({ quotesApi, quoteId, user, onBack, onEdit, onDuplicate, onInfo, onConvert }: QuoteDetailProps): ReactElement {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [cancelling, setCancelling] = useState<{ readonly reason: string; readonly pin: string } | null>(null);
  const { isBusy, message, setMessage, run } = useAction();

  const load = useCallback(() => {
    quotesApi.get(quoteId).then(setQuote, () => setMessage('No se pudo leer la cotización.'));
  }, [quotesApi, quoteId, setMessage]);

  useEffect(load, [load]);

  if (quote === null) {
    return (
      <section className="quote-detail" aria-busy="true">
        <Message text={message} />
      </section>
    );
  }
  const isOpen = quote.status === 'draft' || quote.status === 'expired';
  const needsOwnerPin = user.role !== 'owner' && quote.createdById !== user.id;
  const changedPrices = quote.status === 'draft' ? quote.lines.filter((line) => line.currentPriceE4 !== null && line.currentPriceE4 !== line.unitPriceE4).length : 0;

  const showPreview = (): void => {
    run(async () => {
      setPreview(await quotesApi.preview(quote.id));
    });
  };

  const print = (): void => {
    run(async () => {
      const result = await quotesApi.print(quote.id);
      if (result.status === 'printed') {
        onInfo(`Cotización ${quote.folio} impresa.`);
        setPreview(null);
        load();
      } else if (result.status === 'no_printer') {
        setMessage('No hay impresora de tickets configurada. El dueño la elige en Ajustes.');
      } else {
        setMessage(`No se pudo imprimir: ${result.message}`);
      }
    });
  };

  const cancel = (): void => {
    if (cancelling === null) {
      return;
    }
    run(async () => {
      const result = await quotesApi.cancel({ quoteId: quote.id, reason: cancelling.reason, ...(needsOwnerPin ? { ownerPin: cancelling.pin } : {}) });
      switch (result.status) {
        case 'cancelled':
          setCancelling(null);
          setQuote(result.quote);
          onInfo(`Cotización ${quote.folio} cancelada.`);
          return;
        case 'invalid':
          setMessage(result.message);
          return;
        case 'owner_pin_required':
          setMessage('La hizo otra persona: escribe el PIN del dueño para cancelarla.');
          return;
        case 'wrong_pin':
          setMessage(`PIN del dueño incorrecto. Quedan ${String(result.attemptsLeft)} intentos.`);
          return;
        case 'locked':
          setMessage('Demasiados intentos con el PIN del dueño. Espera unos minutos.');
          return;
        case 'not_cancellable':
          setCancelling(null);
          setMessage('Esta cotización ya se vendió o se canceló.');
          load();
      }
    });
  };

  const convert = (): void => {
    run(async () => {
      const result = await quotesApi.prepareConversion(quote.id);
      if (result.status === 'ready') {
        onConvert(result);
      } else {
        setMessage(result.message);
      }
    });
  };

  return (
    <section className="quote-detail" aria-label={`Cotización ${quote.folio}`}>
      <header className="quote-detail-header">
        <h3>
          {quote.folio}{' '}
          <span className="badge" data-tone={quote.status}>
            {QUOTE_STATUS_LABELS[quote.status]}
          </span>
        </h3>
        <p>
          {quote.customerName ?? 'Sin nombre'}
          {quote.customerPhone === null ? '' : ` · ${quote.customerPhone}`} · Hizo {quote.createdByName} el {formatSaleMoment(quote.createdAt)} · Válida hasta el {quoteDayLabel(quote.validUntil)}
        </p>
      </header>
      {quote.status === 'expired' && <p className="notice">Esta cotización venció. Si la vendes, se cobra con los precios de hoy.</p>}
      {changedPrices > 0 && (
        <p className="notice" role="status">
          {changedPrices === 1 ? 'Un precio cambió' : `${String(changedPrices)} precios cambiaron`} desde la cotización. Mientras esté vigente se respeta el precio cotizado.
        </p>
      )}
      <table className="order-lines quote-lines">
        <thead>
          <tr>
            <th scope="col">Producto</th>
            <th scope="col">Cantidad</th>
            <th scope="col">Precio cotizado</th>
            <th scope="col">Precio de hoy</th>
            <th scope="col">Importe</th>
          </tr>
        </thead>
        <tbody>
          {quote.lines.map((line) => (
            <tr key={line.productId}>
              <td>{line.productName}</td>
              <td>{formatQuantity(line.quantity)}</td>
              <td>{formatUnitPriceE4(line.unitPriceE4)}</td>
              <td data-changed={line.currentPriceE4 !== null && line.currentPriceE4 !== line.unitPriceE4}>{line.currentPriceE4 === null ? 'Ya no se vende' : formatUnitPriceE4(line.currentPriceE4)}</td>
              <td>{formatCents(line.totalCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="quote-total" aria-label="Total cotizado">
        Total {formatCents(quote.totalCents)}
      </p>
      {quote.notes !== null && <p className="quote-notes">Notas: {quote.notes}</p>}
      <Message text={message} />
      {preview !== null && (
        <figure className="ticket-preview">
          <figcaption>Vista previa de la cotización</figcaption>
          <pre aria-label="Vista previa de la cotización">{preview.join('\n')}</pre>
          <div className="order-actions">
            <button type="button" className="button" disabled={isBusy} onClick={() => setPreview(null)}>
              Cerrar vista previa
            </button>
            <button type="button" className="button button-primary" disabled={isBusy} onClick={print}>
              {quote.timesPrinted > 0 ? 'Reimprimir' : 'Imprimir'}
            </button>
          </div>
        </figure>
      )}
      {cancelling !== null && (
        <section className="quote-cancel" aria-label="Cancelar cotización">
          <Field label="¿Por qué se cancela?" value={cancelling.reason} onChange={(reason) => setCancelling({ ...cancelling, reason })} autoFocus maxLength={120} onEnter={cancel} />
          {needsOwnerPin && <Field label="PIN del dueño" type="password" numeric="integer" value={cancelling.pin} onChange={(pin) => setCancelling({ ...cancelling, pin })} maxLength={12} onEnter={cancel} />}
          <div className="order-actions">
            <button type="button" className="button" disabled={isBusy} onClick={() => setCancelling(null)}>
              No cancelar
            </button>
            <button type="button" className="button button-danger" disabled={isBusy} onClick={cancel}>
              Sí, cancelar la cotización
            </button>
          </div>
        </section>
      )}
      <div className="order-actions">
        <button type="button" className="button" onClick={onBack}>
          Volver a la lista
        </button>
        {isOpen && (
          <button type="button" className="button" disabled={isBusy} onClick={() => onEdit(quote)}>
            Editar
          </button>
        )}
        <button type="button" className="button" disabled={isBusy} onClick={() => onDuplicate(quote)}>
          Duplicar
        </button>
        <button type="button" className="button" disabled={isBusy} onClick={showPreview}>
          {quote.timesPrinted > 0 ? 'Reimprimir' : 'Imprimir'}
        </button>
        {isOpen && cancelling === null && (
          <button type="button" className="button button-danger" disabled={isBusy} onClick={() => setCancelling({ reason: '', pin: '' })}>
            Cancelar cotización
          </button>
        )}
        {isOpen && (
          <button type="button" className="button button-primary" disabled={isBusy} onClick={convert}>
            Convertir en venta
          </button>
        )}
      </div>
      <section className="quote-history" aria-label="Historial de la cotización">
        <h4>Historial</h4>
        <ol>
          {quote.history.map((event, index) => (
            <li key={`${event.at}-${String(index)}`}>
              {formatSaleMoment(event.at)} · {EVENT_LABELS[event.status]} · {event.byName}
              {event.note === null ? '' : ` · ${event.note}`}
            </li>
          ))}
          {quote.timesPrinted > 0 && <li>Impresa {quote.timesPrinted === 1 ? '1 vez' : `${String(quote.timesPrinted)} veces`}</li>}
        </ol>
      </section>
    </section>
  );
}
