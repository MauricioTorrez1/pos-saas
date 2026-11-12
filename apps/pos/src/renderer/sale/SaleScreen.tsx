import { formatUnitPriceE4 } from '@pos-saas/money';
import { useCallback, useEffect, useReducer, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';

import { isMiscLineId, MISC_LINE_ID_PREFIX, MISC_TAX_RATE_BP } from '../../shared/miscellaneous';
import { MAX_LOOKUP_TEXT_LENGTH, type CatalogProduct, type PendingSale, type PosApi, type SavePendingSaleResult } from '../../shared/pos-api';
import type { PricingApi } from '../../shared/pricing';
import type { ProductAdminApi, ProductDetail } from '../../shared/product-admin';
import { CheckoutDialog } from '../checkout/CheckoutDialog';
import { PriceChangeDialog } from '../pricing/PriceChangeDialog';
import { NewProductDialog } from '../products/NewProductDialog';
import { ProductPanelDialog } from '../products/ProductPanelDialog';
import { newProductFormFor, type ProductFormValues } from '../products/product-form';
import { describeReprint, REPRINT_FAILED } from '../checkout/reprint-message';
import { MiscItemDialog, type MiscItem } from './MiscItemDialog';
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

function describeMiscRefusal(result: Extract<SavePendingSaleResult, { status: 'authorization_required' | 'wrong_pin' | 'locked' }>): string {
  switch (result.status) {
    case 'authorization_required':
      return 'El artículo varios lo aprueba el dueño. Quítalo y agrégalo otra vez con su PIN. No se cobró nada.';
    case 'wrong_pin':
      return `PIN del dueño incorrecto. Quedan ${result.attemptsLeft} intentos. Quita el artículo varios y agrégalo otra vez. No se cobró nada.`;
    case 'locked':
      return 'Demasiados intentos con el PIN del dueño. Espera unos minutos. No se cobró nada.';
  }
}

function notFoundMessage(text: string): string {
  return `No encontramos «${text}». Revisa el código o busca el producto por nombre.`;
}

function isPrintableKey(event: KeyboardEvent): boolean {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
}

interface SaleScreenProps {
  readonly posApi: PosApi;
  /** The prices of the catalog. Without it, F7 does nothing and the sale is saved with the catalog prices only. */
  readonly pricingApi?: PricingApi;
  /** Adding products that are not in the catalog (E1-42). Without it, F5 does nothing and a missing product only says so. */
  readonly productApi?: ProductAdminApi;
  /** While true, another part of the screen has the keyboard, and the lookup box waits. */
  readonly isKeyboardElsewhere: boolean;
  /** Whether the owner is signed in. A cashier who sells a miscellaneous item needs the PIN of the owner. */
  readonly isOwner?: boolean;
  readonly onOpenAppearance: () => void;
  /** Called when the cashier asks to sign out. */
  readonly onSignOut: () => void;
  /** Called when the cashier asks for the cash of the register, or needs to open it. */
  readonly onOpenCash: () => void;
  /** Called when the cashier asks to take back a sale. */
  readonly onOpenReturns: () => void;
  /** Called when the owner asks for the administration: the catalog of Eleventa and the backups. */
  readonly onOpenAdmin: () => void;
  /** Called after a sale was collected, so the cash of the register is read again. */
  readonly onCashChanged: () => void;
}

/**
 * The sale being rung up. The lookup box keeps the keyboard at all times, so a scan always lands there. It is not a
 * controlled input: a scan is a burst of keys, and redrawing the screen on each one would only slow it down.
 *
 * @param props.posApi bridge to the main process
 * @param props.pricingApi bridge for changing the price of a product, when the register offers it
 * @param props.productApi bridge for adding a product that is not in the catalog, when the register offers it
 * @param props.isKeyboardElsewhere whether a dialog is using the keyboard
 * @param props.onOpenAppearance called when the cashier asks for the appearance dialog
 * @param props.onSignOut called when the cashier asks to sign out
 * @param props.onOpenCash called when the cashier asks for the cash of the register
 * @param props.onOpenReturns called when the cashier asks to take back a sale
 * @param props.onOpenAdmin called when the owner asks for the administration
 * @param props.onCashChanged called after a sale was collected
 * @returns the screen
 */
export function SaleScreen({ posApi, pricingApi, productApi, isKeyboardElsewhere, isOwner = false, onOpenAppearance, onSignOut, onOpenCash, onOpenReturns, onOpenAdmin, onCashChanged }: SaleScreenProps): ReactElement {
  const [sale, dispatch] = useReducer(saleReducer, EMPTY_SALE);
  const [notice, setNotice] = useState<string | null>(null);
  const [detector] = useState(() => new ScanDetector());
  const [savedSale, setSavedSale] = useState<PendingSale | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState<CatalogProduct | null>(null);
  const [isAddingMisc, setIsAddingMisc] = useState(false);
  /** The price dialog, with the product it starts from. Null while it is closed. */
  const [priceChange, setPriceChange] = useState<{ readonly product: CatalogProduct | null } | null>(null);
  /** What was looked for and not found, so the cashier can add it as a new product (E1-42). */
  const [missing, setMissing] = useState<{ readonly text: string; readonly fromScanner: boolean } | null>(null);
  /** The panel of a product (E1-43), with the product it starts from. Null while it is closed. */
  const [productPanel, setProductPanel] = useState<{ readonly product: CatalogProduct | null } | null>(null);
  /** The form of a new product, with what is loaded in it. Null while it is closed. */
  const [newProduct, setNewProduct] = useState<{ readonly initial: ProductFormValues; readonly lookedFor: string | null } | null>(null);
  const isSaving = useRef(false);
  /** The PIN the owner typed for the miscellaneous items of this sale. It lives only until the sale is saved or cleared. */
  const ownerPin = useRef<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  const showCatalogFailure = useCallback(() => setNotice(CATALOG_FAILURE), []);
  const search = useProductSearch(posApi, showCatalogFailure);

  useEffect(() => {
    if (!isKeyboardElsewhere && savedSale === null && measuring === null && !isAddingMisc && priceChange === null && newProduct === null && productPanel === null) {
      inputRef.current?.focus();
    }
  }, [isKeyboardElsewhere, savedSale, measuring, isAddingMisc, priceChange, newProduct, productPanel]);

  const addMiscItem = ({ name, unitPriceE4, quantityMilli, ownerPin: pin }: MiscItem): void => {
    const product: CatalogProduct = {
      id: `${MISC_LINE_ID_PREFIX}${crypto.randomUUID()}`,
      name,
      unit: 'piece',
      unitPriceE4,
      taxRate: { factor: 'rate', rateBp: MISC_TAX_RATE_BP },
    };
    dispatch({ type: 'add-product', product, quantityMilli });
    if (pin !== undefined) {
      ownerPin.current = pin;
    }
    setIsAddingMisc(false);
    setNotice(null);
  };

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
    if (isSaving.current || isKeyboardElsewhere || measuring !== null || isAddingMisc || priceChange !== null || newProduct !== null || productPanel !== null) {
      return;
    }
    isSaving.current = true;
    try {
      const hasMisc = sale.lines.some((line) => isMiscLineId(line.product.id));
      const idempotencyKey = crypto.randomUUID();
      const saveSale = (withSeenPrices: boolean): Promise<SavePendingSaleResult> =>
        posApi.savePendingSale({
          idempotencyKey,
          lines: sale.lines.map(({ product, quantity }) =>
            isMiscLineId(product.id)
              ? { miscellaneous: { name: product.name, unitPriceE4: product.unitPriceE4 }, quantityMilli: quantity.milli }
              : { productId: product.id, quantityMilli: quantity.milli, ...(withSeenPrices ? { unitPriceE4: product.unitPriceE4 } : {}) },
          ),
          expectedTotalCents: sale.totals.totalCents,
          ...(hasMisc && ownerPin.current !== undefined ? { ownerPin: ownerPin.current } : {}),
        });
      let result = await saveSale(false);
      // The owner may have changed a price while this sale was being rung up. The lines keep the price they show, so the
      // sale is offered again with those prices, and the main process honors them only if they are the price just replaced
      // (ADR 0047). Nothing was saved the first time.
      if (result.status === 'catalog_changed' && pricingApi !== undefined) {
        result = await saveSale(true);
      }
      if (result.status === 'saved') {
        setSavedSale(result.sale);
      } else if (result.status === 'no_cash_session') {
        setNotice(CASH_CLOSED);
        onOpenCash();
      } else if (result.status === 'authorization_required' || result.status === 'wrong_pin' || result.status === 'locked') {
        ownerPin.current = undefined;
        setNotice(describeMiscRefusal(result));
      } else {
        setNotice(CATALOG_CHANGED);
      }
    } catch {
      setNotice(SAVE_FAILURE);
    } finally {
      isSaving.current = false;
    }
  };

  // The product to start from is the one the cashier is pointing at: the highlighted result, or else the selected line.
  const openPriceChange = (): void => {
    if (pricingApi === undefined || isSaving.current) {
      return;
    }
    const highlighted = search.results[search.highlightedIndex];
    const selectedLine = sale.lines.find((line) => line.product.id === sale.selectedProductId);
    const product = highlighted ?? (selectedLine !== undefined && !isMiscLineId(selectedLine.product.id) ? selectedLine.product : null);
    setPriceChange({ product });
  };

  const finishPriceChange = (product: CatalogProduct, previousUnitPriceE4: number): void => {
    setPriceChange(null);
    // What the lookup box listed still shows the old price, and the next search must show the new one.
    clearLookup();
    setInfo(
      `Precio de ${product.name}: ${formatUnitPriceE4(previousUnitPriceE4)} → ${formatUnitPriceE4(product.unitPriceE4)}. La venta que armaste conserva los precios de sus productos.`,
    );
  };

  // The product to start from is the one the cashier is pointing at, as with the price.
  const openProductPanel = (): void => {
    if (productApi === undefined || isSaving.current) {
      return;
    }
    const highlighted = search.results[search.highlightedIndex];
    const selectedLine = sale.lines.find((line) => line.product.id === sale.selectedProductId);
    setProductPanel({ product: highlighted ?? (selectedLine !== undefined && !isMiscLineId(selectedLine.product.id) ? selectedLine.product : null) });
  };

  const openNewProduct = (): void => {
    if (productApi === undefined || isSaving.current) {
      return;
    }
    setNewProduct({ initial: newProductFormFor(missing?.text ?? '', missing?.fromScanner ?? false), lookedFor: missing?.text ?? null });
  };

  const finishNewProduct = (product: ProductDetail): void => {
    const lookedFor = newProduct?.lookedFor ?? null;
    setNewProduct(null);
    setMissing(null);
    setNotice(null);
    clearLookup();
    if (lookedFor !== null && product.isActive) {
      // The product the customer brought is the one being rung up, so it goes straight onto the sale.
      addProduct({ id: product.id, name: product.name, unit: product.unit, unitPriceE4: product.unitPriceE4, taxRate: product.taxRate }, lookedFor);
      setInfo(`Producto nuevo: ${product.name}. Ya está en la venta y en el catálogo.`);
    } else {
      setInfo(`Producto nuevo: ${product.name}. Quedó guardado con tu nombre.`);
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
      ownerPin.current = undefined;
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
        setMissing({ text, fromScanner });
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
      setMissing({ text, fromScanner: false });
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
        setMissing(null);
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
      case 'F2':
        event.preventDefault();
        setIsAddingMisc(true);
        return;
      case 'F8':
        event.preventDefault();
        void reprintLast();
        return;
      case 'F7':
        event.preventDefault();
        openPriceChange();
        return;
      case 'F5':
        event.preventDefault();
        openNewProduct();
        return;
      case 'F10':
        event.preventDefault();
        openProductPanel();
        return;
      case 'F6':
        event.preventDefault();
        onSignOut();
        return;
      case 'F3':
        event.preventDefault();
        onOpenCash();
        return;
      case 'F4':
        event.preventDefault();
        onOpenReturns();
        return;
      case 'F1':
        event.preventDefault();
        onOpenAdmin();
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
    setMissing(null);
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
        {missing !== null && productApi !== undefined && (
          <p>
            <button type="button" className="button" tabIndex={-1} onClick={openNewProduct}>
              Dar de alta «{missing.text}» <kbd>F5</kbd>
            </button>
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
      {isAddingMisc && <MiscItemDialog isOwner={isOwner} onAdd={addMiscItem} onCancel={() => setIsAddingMisc(false)} />}
      {priceChange !== null && pricingApi !== undefined && (
        <PriceChangeDialog
          posApi={posApi}
          pricingApi={pricingApi}
          isOwner={isOwner}
          initialProduct={priceChange.product}
          onChanged={finishPriceChange}
          onCancel={() => setPriceChange(null)}
        />
      )}
      {newProduct !== null && productApi !== undefined && (
        <NewProductDialog
          posApi={posApi}
          productApi={productApi}
          isOwner={isOwner}
          initialValues={newProduct.initial}
          onCreated={finishNewProduct}
          onCancel={() => setNewProduct(null)}
        />
      )}
      {productPanel !== null && productApi !== undefined && (
        <ProductPanelDialog
          posApi={posApi}
          productApi={productApi}
          {...(pricingApi === undefined ? {} : { pricingApi })}
          isOwner={isOwner}
          initialProduct={productPanel.product}
          onClose={() => {
            setProductPanel(null);
            // What the lookup box listed may now be out of date: a name, a code or a state changed.
            clearLookup();
          }}
        />
      )}
      {measuring !== null && <QuantityDialog product={measuring} onConfirm={confirmQuantity} onCancel={() => setMeasuring(null)} />}
      {savedSale !== null && <CheckoutDialog posApi={posApi} sale={savedSale} onFinished={finishCheckout} />}
    </main>
  );
}
