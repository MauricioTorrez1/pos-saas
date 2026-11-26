import { formatUnitPriceE4 } from '@pos-saas/money';
import { useCallback, useEffect, useReducer, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';

import { isMiscLineId, MISC_LINE_ID_PREFIX, MISC_TAX_RATE_BP } from '../../shared/miscellaneous';
import { MAX_LOOKUP_TEXT_LENGTH, type CatalogProduct, type PendingSale, type PosApi, type SavePendingSaleResult } from '../../shared/pos-api';
import type { PurchasingApi } from '../../shared/supplier-order';
import type { PricingApi } from '../../shared/pricing';
import { actionOf, comboLabel, DEFAULT_KEYMAP, type KeyAction, type Keymap, type ToolsApi } from '../../shared/register-tools';
import type { ProductAdminApi, ProductDetail } from '../../shared/product-admin';
import type { PrepareConversionResult } from '../../shared/quotes';
import { CheckoutDialog } from '../checkout/CheckoutDialog';
import { NewProductDialog } from '../products/NewProductDialog';
import { ProductPanelDialog } from '../products/ProductPanelDialog';
import { newProductFormFor, type ProductFormValues } from '../products/product-form';
import { describeReprint, REPRINT_FAILED } from '../checkout/reprint-message';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { LinePriceDialog } from './LinePriceDialog';
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
const CASH_NOT_OPENED = 'No se puede cobrar: la caja no está abierta (solo administrar). Ábrela con su fondo de caja (F3) para cobrar.';
const NO_LINE_FOR_PRICE = 'Elige primero un producto de la venta: agrégalo o muévete a él con las flechas, y cambia su precio para esta venta.';
const MISC_PRICE = 'El artículo varios ya lleva el precio que escribiste. Quítalo y agrégalo otra vez para cambiarlo.';
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
  /** Called when the person asks for the summary of the business (E1-45). Without it, F11 does nothing. */
  readonly onOpenDashboard?: () => void;
  /** Opens the orders to suppliers (E1-44) with Shift+F11. Without it, Shift+F11 does nothing. */
  readonly onOpenSupplierOrder?: () => void;
  /** The suppliers and their orders, for «Pedir más» in the product panel (E1-50). */
  readonly purchasingApi?: PurchasingApi;
  /** Called after a sale was collected, so the cash of the register is read again. */
  readonly onCashChanged: () => void;
  /** False while nobody opened the cash, as in «Solo administrar»: the sale is rung up, but it cannot be charged (E1-54). */
  readonly isCashOpen?: boolean;
  /** The keys of each action. Without it, the register answers to the keys it was born with. */
  readonly keymap?: Keymap;
  /** Bridge for the tools of the register. Without it, a dropped sale leaves no entry in the audit log. */
  readonly toolsApi?: ToolsApi;
  /** Opens the settings of the register. Without it, its key does nothing. */
  readonly onOpenSettings?: () => void;
  /** Opens the list of sales, where a past sale is cancelled. Without it, its key does nothing. */
  readonly onOpenSalesHistory?: () => void;
  /** Opens the log of missing items with what was looked for. Without it, its key does nothing. */
  readonly onOpenMissingItems?: (text: string) => void;
  /** Opens the panel of the quotes (F2-07). Without it, its key does nothing. */
  readonly onOpenQuotes?: () => void;
  /** A quote the person chose to sell, to ring up in place of an empty sale. */
  readonly incomingQuote?: Extract<PrepareConversionResult, { status: 'ready' }> | null;
  /** Called once the incoming quote was rung up or refused, so it is not taken twice. */
  readonly onIncomingQuoteTaken?: () => void;
  /** Called after the sale of a quote was collected, to mark the quote as sold with its sale. */
  readonly onQuoteSold?: (quoteId: string, saleId: string) => void;
}

const SALE_NOT_EMPTY_FOR_QUOTE = 'La venta en curso ya tiene productos. Cóbrala o cancélala y vuelve a convertir la cotización.';

/** What the cashier is told when a quote lands on the sale. */
function describeLoadedQuote(quote: Extract<PrepareConversionResult, { status: 'ready' }>): string {
  const parts = [`Venta de la cotización ${quote.folio}.`];
  if (quote.isExpired) {
    parts.push('La cotización venció: se cobra con los precios de hoy.');
  } else {
    const changed = quote.lines.filter((line) => line.chargedPriceE4 !== line.product.unitPriceE4).length;
    if (changed > 0) {
      parts.push(`${changed === 1 ? 'Un precio de hoy es distinto' : `${String(changed)} precios de hoy son distintos`}: se respeta el precio cotizado.`);
    }
  }
  if (quote.skipped.length > 0) {
    parts.push(`Ya no se vende${quote.skipped.length === 1 ? '' : 'n'}: ${quote.skipped.join(', ')}.`);
  }
  return parts.join(' ');
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
 * @param props.onOpenDashboard called when the person asks for the summary of the business
 * @param props.onOpenSupplierOrder called when the person asks for the orders to suppliers (Shift+F11)
 * @param props.onCashChanged called after a sale was collected
 * @param props.isCashOpen false while the cash is not open, so a sale cannot be charged
 * @returns the screen
 */
export function SaleScreen({ posApi, pricingApi, productApi, isKeyboardElsewhere, isOwner = false, onOpenAppearance, onSignOut, onOpenCash, onOpenReturns, onOpenAdmin, onOpenDashboard, onOpenSupplierOrder, onCashChanged, isCashOpen = true, keymap = DEFAULT_KEYMAP, toolsApi, onOpenSettings, onOpenSalesHistory, onOpenMissingItems, onOpenQuotes, incomingQuote = null, onIncomingQuoteTaken, onQuoteSold, purchasingApi }: SaleScreenProps): ReactElement {
  const [sale, dispatch] = useReducer(saleReducer, EMPTY_SALE);
  const [notice, setNotice] = useState<string | null>(null);
  const [detector] = useState(() => new ScanDetector());
  const [savedSale, setSavedSale] = useState<PendingSale | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [measuring, setMeasuring] = useState<CatalogProduct | null>(null);
  const [isAddingMisc, setIsAddingMisc] = useState(false);
  /** Whether the price of the selected line is being changed for this sale. */
  const [isPricingLine, setIsPricingLine] = useState(false);
  /** Whether the cashier is being asked before the sale is dropped. */
  const [isCancelling, setIsCancelling] = useState(false);
  /** What was looked for and not found, so the cashier can add it as a new product (E1-42). */
  const [missing, setMissing] = useState<{ readonly text: string; readonly fromScanner: boolean } | null>(null);
  /** The panel of a product (E1-43), with the product it starts from. Null while it is closed. */
  const [productPanel, setProductPanel] = useState<{ readonly product: CatalogProduct | null } | null>(null);
  /** The form of a new product, with what is loaded in it. Null while it is closed. */
  const [newProduct, setNewProduct] = useState<{ readonly initial: ProductFormValues; readonly lookedFor: string | null } | null>(null);
  /** The quote this sale comes from (F2-07), until it is collected or dropped. */
  const [fromQuote, setFromQuote] = useState<{ readonly id: string; readonly folio: string } | null>(null);
  const isSaving = useRef(false);
  /** The PIN the owner typed for the miscellaneous items of this sale. It lives only until the sale is saved or cleared. */
  const ownerPin = useRef<string | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  const showCatalogFailure = useCallback(() => setNotice(CATALOG_FAILURE), []);

  useEffect(() => {
    if (incomingQuote === null) {
      return;
    }
    onIncomingQuoteTaken?.();
    if (sale.lines.length > 0 || savedSale !== null) {
      setNotice(SALE_NOT_EMPTY_FOR_QUOTE);
      return;
    }
    dispatch({ type: 'load-quote', lines: incomingQuote.lines });
    setFromQuote({ id: incomingQuote.quoteId, folio: incomingQuote.folio });
    setNotice(null);
    setInfo(describeLoadedQuote(incomingQuote));
    // Only a new quote is taken; the sale it lands on is read as it was at that moment.
  }, [incomingQuote]);

  // A sale emptied by hand is no longer the sale of its quote.
  useEffect(() => {
    if (sale.lines.length === 0 && fromQuote !== null) {
      setFromQuote(null);
    }
  }, [sale.lines.length, fromQuote]);
  const search = useProductSearch(posApi, showCatalogFailure);

  useEffect(() => {
    if (!isKeyboardElsewhere && savedSale === null && measuring === null && !isAddingMisc && !isPricingLine && !isCancelling && newProduct === null && productPanel === null) {
      inputRef.current?.focus();
    }
  }, [isKeyboardElsewhere, savedSale, measuring, isAddingMisc, isPricingLine, isCancelling, newProduct, productPanel]);

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
    if (isSaving.current || isKeyboardElsewhere || measuring !== null || isAddingMisc || isPricingLine || isCancelling || newProduct !== null || productPanel !== null) {
      return;
    }
    if (!isCashOpen) {
      setNotice(CASH_NOT_OPENED);
      onOpenCash();
      return;
    }
    isSaving.current = true;
    try {
      const hasMisc = sale.lines.some((line) => isMiscLineId(line.product.id));
      const idempotencyKey = crypto.randomUUID();
      const saveSale = (withSeenPrices: boolean): Promise<SavePendingSaleResult> =>
        posApi.savePendingSale({
          idempotencyKey,
          lines: sale.lines.map(({ product, quantity, catalogPriceE4 }) =>
            isMiscLineId(product.id)
              ? { miscellaneous: { name: product.name, unitPriceE4: product.unitPriceE4 }, quantityMilli: quantity.milli }
              : catalogPriceE4 !== undefined
                ? { productId: product.id, quantityMilli: quantity.milli, saleUnitPriceE4: product.unitPriceE4 }
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

  // The price of the selected line, for this sale only. The catalog keeps its price (ADR 0061).
  const openLinePrice = (): void => {
    if (isSaving.current) {
      return;
    }
    const selectedLine = sale.lines.find((line) => line.product.id === sale.selectedProductId);
    if (selectedLine === undefined) {
      setNotice(NO_LINE_FOR_PRICE);
    } else if (isMiscLineId(selectedLine.product.id)) {
      setNotice(MISC_PRICE);
    } else {
      setIsPricingLine(true);
    }
  };

  const finishLinePrice = (unitPriceE4: number): void => {
    const line = sale.lines.find((candidate) => candidate.product.id === sale.selectedProductId);
    setIsPricingLine(false);
    if (line === undefined) {
      return;
    }
    const catalogPriceE4 = line.catalogPriceE4 ?? line.product.unitPriceE4;
    dispatch({ type: 'set-line-price', unitPriceE4 });
    setNotice(null);
    setInfo(
      unitPriceE4 === catalogPriceE4
        ? `${line.product.name} vuelve a su precio del catálogo: ${formatUnitPriceE4(catalogPriceE4)}.`
        : `${line.product.name} se cobra a ${formatUnitPriceE4(unitPriceE4)} solo en esta venta. El catálogo sigue en ${formatUnitPriceE4(catalogPriceE4)}.`,
    );
  };

  const askToCancelSale = (): void => {
    if (sale.lines.length > 0 && !isSaving.current) {
      setIsCancelling(true);
    }
  };

  const cancelSale = (): void => {
    // The entry is best effort: a sale that was never saved must be dropped even if the log cannot be written.
    toolsApi?.recordSaleCancelled({ lineCount: sale.lines.length, totalCents: sale.totals.totalCents }).catch(() => undefined);
    setIsCancelling(false);
    ownerPin.current = undefined;
    setFromQuote(null);
    dispatch({ type: 'clear' });
    clearLookup();
    setNotice(null);
    setMissing(null);
    setInfo('Venta cancelada. No se cobró nada.');
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
    const collectedId = savedSale?.id;
    setSavedSale(null);
    if (wasCollected) {
      if (fromQuote !== null && collectedId !== undefined) {
        onQuoteSold?.(fromQuote.id, collectedId);
      }
      setFromQuote(null);
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
    } else if (event.key === 'Delete' && !event.shiftKey && !event.ctrlKey && !event.altKey) {
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

  const runAction = (action: KeyAction): void => {
    switch (action) {
      case 'checkout':
        void startCheckout();
        return;
      case 'misc':
        setIsAddingMisc(true);
        return;
      case 'linePrice':
        openLinePrice();
        return;
      case 'cancelSale':
        askToCancelSale();
        return;
      case 'newProduct':
        openNewProduct();
        return;
      case 'productPanel':
        openProductPanel();
        return;
      case 'cash':
        onOpenCash();
        return;
      case 'returns':
        onOpenReturns();
        return;
      case 'salesHistory':
        onOpenSalesHistory?.();
        return;
      case 'quotes':
        onOpenQuotes?.();
        return;
      case 'missingItems':
        onOpenMissingItems?.(missing?.text ?? '');
        setMissing(null);
        return;
      case 'reprint':
        void reprintLast();
        return;
      case 'dashboard':
        onOpenDashboard?.();
        return;
      case 'supplierOrder':
        onOpenSupplierOrder?.();
        return;
      case 'admin':
        onOpenAdmin();
        return;
      case 'appearance':
        onOpenAppearance();
        return;
      case 'settings':
        onOpenSettings?.();
        return;
      case 'signOut':
        onSignOut();
        return;
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
      default: {
        const action = actionOf(keymap, event);
        if (action !== null) {
          event.preventDefault();
          // A dialog that is open owns its keys: the same key may mean something else there.
          if (!isKeyboardElsewhere) {
            runAction(action);
          }
          return;
        }
        if (isPrintableKey(event)) {
          detector.recordCharacter(event.timeStamp);
        } else if (event.key === 'Backspace' || event.key === 'Delete') {
          detector.recordEdit();
        }
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
        {missing !== null && (productApi !== undefined || onOpenMissingItems !== undefined) && (
          <p className="not-found-actions">
            {productApi !== undefined && (
              <button type="button" className="button" tabIndex={-1} onClick={openNewProduct}>
                Dar de alta «{missing.text}» <kbd>{comboLabel(keymap.newProduct)}</kbd>
              </button>
            )}
            {onOpenMissingItems !== undefined && !missing.fromScanner && (
              <button type="button" className="button" tabIndex={-1} onClick={() => runAction('missingItems')}>
                Anotar como faltante <kbd>{comboLabel(keymap.missingItems)}</kbd>
              </button>
            )}
          </p>
        )}
        {fromQuote !== null && (
          <p className="quote-sale-banner" aria-label="Venta de cotización">
            Cotización {fromQuote.folio}
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
      {isPricingLine && sale.lines.some((line) => line.product.id === sale.selectedProductId) && (
        <LinePriceDialog
          line={sale.lines.find((line) => line.product.id === sale.selectedProductId)!}
          onConfirm={finishLinePrice}
          onCancel={() => setIsPricingLine(false)}
        />
      )}
      {isCancelling && (
        <ConfirmDialog title="¿Cancelar esta venta?" confirmLabel="Sí, cancelar la venta" isDangerous onConfirm={cancelSale} onCancel={() => setIsCancelling(false)}>
          <p>
            {sale.lines.length === 1 ? 'Se quita el producto' : `Se quitan los ${String(sale.lines.length)} productos`} de la venta. No se cobró nada todavía, así que no hay nada que devolver.
          </p>
        </ConfirmDialog>
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
          {...(purchasingApi === undefined ? {} : { purchasingApi })}
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
