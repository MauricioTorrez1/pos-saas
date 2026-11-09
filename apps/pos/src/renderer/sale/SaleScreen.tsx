import { useCallback, useEffect, useReducer, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';

import { MAX_LOOKUP_TEXT_LENGTH, type CatalogProduct, type PendingSale, type PosApi } from '../../shared/pos-api';
import { CheckoutDialog } from '../checkout/CheckoutDialog';
import { describeReprint, REPRINT_FAILED } from '../checkout/reprint-message';
import { QuantityDialog } from './QuantityDialog';
import { needsMeasuring } from './quantity-entry';
import { SaleLines } from './SaleLines';
import { EMPTY_SALE, saleReducer } from './sale-state';
import { SaleSummary } from './SaleSummary';
import { ScanDetector } from './scan-detector';
import { SearchResults, resultOptionId, SEARCH_RESULTS_ID } from './SearchResults';
import { useProductSearch } from './use-product-search';

const CATALOG_FAILURE = 'No se pudo consultar el catálogo. Intenta de nuevo y, si sigue fallando, reinicia la caja.';

const EMPTY_SALE_MESSAGE = 'Agrega al menos un producto para cobrar.';
const CATALOG_CHANGED =
  'El catálogo cambió mientras armabas la venta, y un precio o un producto ya no es el que ves. No se cobró nada. Quita los productos y vuelve a agregarlos para ver los precios nuevos.';
const CASH_CLOSED = 'La caja está cerrada. Ábrela con su fondo para poder cobrar.';
const SAVE_FAILURE = 'No se pudo guardar la venta. No se cobró nada. Intenta de nuevo y, si sigue fallando, reinicia la caja.';

function notFoundMessage(text: string): string {
  return `No encontramos «${text}». Revisa el código o busca el producto por nombre.`;
}

function isPrintableKey(event: KeyboardEvent): boolean {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
}

interface SaleScreenProps {
  readonly posApi: PosApi;
  /** While true, another part of the screen has the keyboard, and the lookup box waits. */
  readonly isKeyboardElsewhere: boolean;
  readonly onOpenAppearance: () => void;
  /** Called when the cashier asks to sign out. */
  readonly onSignOut: () => void;
  /** Called when the cashier asks for the cash of the register, or needs to open it. */
  readonly onOpenCash: () => void;
  /** Called after a sale was collected, so the cash of the register is read again. */
  readonly onCashChanged: () => void;
}

/**
 * The sale being rung up. The lookup box keeps the keyboard at all times, so a scan always lands there. It is not a
 * controlled input: a scan is a burst of keys, and redrawing the screen on each one would only slow it down.
 *
 * @param props.posApi bridge to the main process
 * @param props.isKeyboardElsewhere whether a dialog is using the keyboard
 * @param props.onOpenAppearance called when the cashier asks for the appearance dialog
 * @param props.onSignOut called when the cashier asks to sign out
 * @param props.onOpenCash called when the cashier asks for the cash of the register
 * @param props.onCashChanged called after a sale was collected
 * @returns the screen
 */
export function SaleScreen({ posApi, isKeyboardElsewhere, onOpenAppearance, onSignOut, onOpenCash, onCashChanged }: SaleScreenProps): ReactElement {
  const [sale, dispatch] = useReducer(saleReducer, EMPTY_SALE);
  const [notice, setNotice] = useState<string | null>(null);
  const [detector] = useState(() => new ScanDetector());
  const [savedSale, setSavedSale] = useState<PendingSale | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState<CatalogProduct | null>(null);
  const isSaving = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const showCatalogFailure = useCallback(() => setNotice(CATALOG_FAILURE), []);
  const search = useProductSearch(posApi, showCatalogFailure);

  useEffect(() => {
    if (!isKeyboardElsewhere && savedSale === null && measuring === null) {
      inputRef.current?.focus();
    }
  }, [isKeyboardElsewhere, savedSale, measuring]);

  const confirmQuantity = (quantityMilli: number): void => {
    if (measuring !== null) {
      dispatch({ type: 'add-product', product: measuring, quantityMilli });
    }
    setMeasuring(null);
  };

  // The sale is saved before the payment screen opens, so a power cut while charging leaves it to recover (ADR 0010).
  const startCheckout = async (): Promise<void> => {
    if (sale.lines.length === 0) {
      setNotice(EMPTY_SALE_MESSAGE);
      return;
    }
    if (isSaving.current || isKeyboardElsewhere || measuring !== null) {
      return;
    }
    isSaving.current = true;
    try {
      const result = await posApi.savePendingSale({
        idempotencyKey: crypto.randomUUID(),
        lines: sale.lines.map((line) => ({ productId: line.product.id, quantityMilli: line.quantity.milli })),
        expectedTotalCents: sale.totals.totalCents,
      });
      if (result.status === 'saved') {
        setSavedSale(result.sale);
      } else if (result.status === 'no_cash_session') {
        setNotice(CASH_CLOSED);
        onOpenCash();
      } else {
        setNotice(CATALOG_CHANGED);
      }
    } catch {
      setNotice(SAVE_FAILURE);
    } finally {
      isSaving.current = false;
    }
  };

  const reprintLast = async (): Promise<void> => {
    try {
      setInfo(describeReprint(await posApi.reprintLastTicket()));
    } catch {
      setInfo(REPRINT_FAILED);
    }
  };

  const finishCheckout = (wasCollected: boolean): void => {
    setSavedSale(null);
    if (wasCollected) {
      dispatch({ type: 'clear' });
      setNotice(null);
      onCashChanged();
    }
  };

  const clearLookup = (): void => {
    if (inputRef.current !== null) {
      inputRef.current.value = '';
    }
    detector.reset();
    search.clear();
  };

  const addProduct = (product: CatalogProduct, submittedText: string): void => {
    // What is measured is not added until the cashier says how much, and sees what it costs (RF-012).
    if (needsMeasuring(product)) {
      setMeasuring(product);
    } else {
      dispatch({ type: 'add-product', product });
    }
    setNotice(null);
    // The cashier may already be typing the next product, and that text must stay.
    if (inputRef.current?.value.trim() === submittedText) {
      inputRef.current.value = '';
      detector.reset();
    }
    search.clear();
  };

  const submitLookup = async (text: string, fromScanner: boolean): Promise<void> => {
    try {
      const product = await posApi.findProductByCode(text);
      if (product !== null) {
        addProduct(product, text);
      } else if (fromScanner) {
        setNotice(notFoundMessage(text));
      } else {
        await addHighlightedOrShowResults(text);
      }
    } catch {
      showCatalogFailure();
    }
  };

  const addHighlightedOrShowResults = async (text: string): Promise<void> => {
    const highlighted = search.highlightedFor(text);
    if (highlighted !== null) {
      addProduct(highlighted, text);
      return;
    }
    const results = await search.searchNow(text);
    if (results.length === 0) {
      setNotice(notFoundMessage(text));
    }
  };

  const handleEnter = (): void => {
    const text = inputRef.current?.value.trim() ?? '';
    const fromScanner = detector.isScan();
    detector.reset();
    if (text === '') {
      return;
    }
    if (fromScanner && inputRef.current !== null) {
      // A scan is never edited, and emptying the box now leaves it ready for the next one.
      inputRef.current.value = '';
      search.clear();
    }
    void submitLookup(text, fromScanner);
  };

  const handleLineKey = (event: KeyboardEvent): boolean => {
    if (inputRef.current?.value !== '') {
      return false;
    }
    if (event.key === '+') {
      dispatch({ type: 'change-quantity', units: 1 });
    } else if (event.key === '-') {
      dispatch({ type: 'change-quantity', units: -1 });
    } else if (event.key === 'Delete') {
      dispatch({ type: 'remove-selected' });
    } else {
      return false;
    }
    return true;
  };

  const handleArrow = (offset: 1 | -1): void => {
    if (search.results.length > 0) {
      search.moveHighlight(offset);
    } else {
      dispatch({ type: 'move-selection', offset });
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (handleLineKey(event)) {
      event.preventDefault();
      return;
    }
    switch (event.key) {
      case 'Enter':
        event.preventDefault();
        handleEnter();
        return;
      case 'Escape':
        event.preventDefault();
        clearLookup();
        setNotice(null);
        return;
      case 'ArrowDown':
        event.preventDefault();
        handleArrow(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        handleArrow(-1);
        return;
      case 'F9':
        event.preventDefault();
        onOpenAppearance();
        return;
      case 'F12':
        event.preventDefault();
        void startCheckout();
        return;
      case 'F8':
        event.preventDefault();
        void reprintLast();
        return;
      case 'F6':
        event.preventDefault();
        onSignOut();
        return;
      case 'F3':
        event.preventDefault();
        onOpenCash();
        return;
      default:
        if (isPrintableKey(event)) {
          detector.recordCharacter(event.timeStamp);
        } else if (event.key === 'Backspace' || event.key === 'Delete') {
          detector.recordEdit();
        }
    }
  };

  const handleInput = (): void => {
    setNotice(null);
    setInfo(null);
    const text = inputRef.current?.value.trim() ?? '';
    if (text === '') {
      detector.reset();
      search.clear();
    } else {
      search.schedule(text);
    }
  };

  // A click anywhere takes the focus away, and the next scan must still land in the box.
  const handleBlur = (): void => {
    window.setTimeout(() => {
      if (document.querySelector('dialog[open]') === null) {
        inputRef.current?.focus();
      }
    });
  };

  const handleChooseResult = (product: CatalogProduct): void => {
    addProduct(product, inputRef.current?.value.trim() ?? '');
  };

  const handleSelectLine = useCallback((productId: string) => dispatch({ type: 'select', productId }), []);

  const isListOpen = search.results.length > 0;
  const message = notice ?? sale.problem;

  return (
    <main className="sale">
      <section className="sale-ticket" aria-label="Productos de la venta">
        <div className="lookup">
          <svg className="lookup-glyph" viewBox="0 0 24 16" aria-hidden="true">
            <path d="M1 0h2v16H1zM5 0h1v16H5zM8 0h3v16H8zM13 0h1v16h-1zM16 0h2v16h-2zM20 0h1v16h-1zM22 0h1v16h-1z" />
          </svg>
          <input
            ref={inputRef}
            className="lookup-input"
            type="text"
            role="combobox"
            aria-label="Buscar producto"
            aria-autocomplete="list"
            aria-expanded={isListOpen}
            aria-controls={isListOpen ? SEARCH_RESULTS_ID : undefined}
            aria-activedescendant={isListOpen ? resultOptionId(search.highlightedIndex) : undefined}
            autoComplete="off"
            spellCheck={false}
            maxLength={MAX_LOOKUP_TEXT_LENGTH}
            placeholder="Escanea el código o escribe el nombre del producto"
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
          />
          {isListOpen && (
            <SearchResults results={search.results} highlightedIndex={search.highlightedIndex} onChoose={handleChooseResult} />
          )}
        </div>
        {message !== null && (
          <p className="notice" role="alert">
            {message}
          </p>
        )}
        {info !== null && (
          <p className="notice notice-info" role="status">
            {info}
          </p>
        )}
        <SaleLines lines={sale.lines} selectedProductId={sale.selectedProductId} onSelect={handleSelectLine} />
      </section>
      <SaleSummary lineCount={sale.lines.length} totals={sale.totals} />
      {measuring !== null && <QuantityDialog product={measuring} onConfirm={confirmQuantity} onCancel={() => setMeasuring(null)} />}
      {savedSale !== null && <CheckoutDialog posApi={posApi} sale={savedSale} onFinished={finishCheckout} />}
    </main>
  );
}
