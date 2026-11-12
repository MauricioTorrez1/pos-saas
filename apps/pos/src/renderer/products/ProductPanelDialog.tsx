import { formatUnitPriceE4 } from '@pos-saas/money';
import { useEffect, useState, type ReactElement } from 'react';

import type { PosApi } from '../../shared/pos-api';
import { marginBasisPoints, type PricingApi } from '../../shared/pricing';
import { formatUnitCost, type ProductAdminApi, type ProductPanelDetail, type ProductSummary, type UpdateProductResult } from '../../shared/product-admin';
import { MOVEMENT_LABELS } from '../admin/stock-kinds';
import { PriceChangeDialog } from '../pricing/PriceChangeDialog';
import { formatBasisPoints } from '../pricing/price-input';
import { formatQuantity, formatSaleMoment, formatTaxLabel, unitLabel } from '../sale/format';
import { Field, Message, useAction } from '../ui/form-parts';
import { ModalDialog } from '../ui/ModalDialog';
import { useWindowKeys } from '../ui/use-window-keys';
import { ProductFields } from './ProductFields';
import { StockAdjustDialog } from './StockAdjustDialog';
import { formValuesOf, readEditForm, type ProductFormProblems, type ProductFormValues } from './product-form';

/** How many movements the panel lists. */
const SHOWN_MOVEMENTS = 5;

const STALE = 'Este producto cambió mientras lo editabas, así que no se guardó nada. Ya cargué cómo está ahora: revisa tus cambios y vuelve a intentar.';

/** What to tell the person for each way saving can end without writing. The `updated` case is not here: it shows a note. */
function describeResult(result: Exclude<UpdateProductResult, { status: 'updated' }>): string {
  switch (result.status) {
    case 'unchanged':
      return 'No hay cambios que guardar.';
    case 'not_found':
      return 'El producto ya no está en el catálogo.';
    case 'stale':
      return STALE;
    case 'duplicate_code':
      return `El código ${result.code} ya lo usa «${result.productName}». Quítalo de la lista o corrige ese producto.`;
    case 'unit_locked':
      return `Este producto ya tiene ${result.movementCount} movimiento${result.movementCount === 1 ? '' : 's'} de existencia, así que su unidad no se puede cambiar. Si te equivocaste, dalo de baja y crea otro.`;
    case 'authorization_required':
      return 'Pídele al dueño que escriba su PIN.';
    case 'wrong_pin':
      return `PIN del dueño incorrecto. Quedan ${result.attemptsLeft} intentos. Quedó anotado en la bitácora.`;
    case 'locked':
      return 'Demasiados intentos con el PIN del dueño. Espera unos minutos. Quedó anotado en la bitácora.';
  }
}

/** How the margin of a product reads, or why it cannot be read. */
function describeMargin(product: ProductPanelDetail): string {
  if (product.effectiveCostE6 === null) {
    return 'Sin costo registrado: no se puede calcular el margen.';
  }
  const margin = marginBasisPoints(product.unitPriceE4, product.taxRate, product.effectiveCostE6);
  return margin === null ? 'No se puede calcular el margen.' : `Margen: ${formatBasisPoints(margin)}`;
}

function signed(milli: number, unit: ProductPanelDetail['unit']): string {
  const text = formatQuantity({ milli: Math.abs(milli), unit });
  return milli < 0 ? `−${text}` : milli > 0 ? `+${text}` : text;
}

interface ProductPanelDialogProps {
  readonly posApi: PosApi;
  readonly productApi: ProductAdminApi;
  /** The prices of the catalog. Without it, the panel offers no price change. */
  readonly pricingApi?: PricingApi;
  /** The owner needs no PIN, and a cashier has to type the one of an owner to save. */
  readonly isOwner: boolean;
  /** The product to open. Without it, the panel asks to find one first. */
  readonly initialProduct: { readonly id: string } | null;
  readonly onClose: () => void;
}

/**
 * The panel of a product (E1-43): find it, see its stock, cost, margin and latest movements, and change its name, barcodes,
 * unit, VAT, cost and state, its price and its inventory. It edits with the form of a new product, so both ask the same
 * things in the same words. The price and the inventory go through the dialogs and services of E1-39 and E1-26, so there is
 * one set of rules for each. A cashier sees everything and types the PIN of an owner to save. If the product changed while
 * it was being edited, nothing is written and the panel loads the new state.
 *
 * @param props.posApi bridge to the main process, for barcodes and adjustments
 * @param props.productApi bridge that finds, reads and saves products
 * @param props.pricingApi bridge for the price, when the register offers it
 * @param props.isOwner whether the person at the register is the owner
 * @param props.initialProduct the product to open, if the screen already knows it
 * @param props.onClose called when the person closes the panel
 * @returns the dialog
 */
export function ProductPanelDialog({ posApi, productApi, pricingApi, isOwner, initialProduct, onClose }: ProductPanelDialogProps): ReactElement {
  const [product, setProduct] = useState<ProductPanelDetail | null>(null);
  const [values, setValues] = useState<ProductFormValues | null>(null);
  const [problems, setProblems] = useState<ProductFormProblems>({});
  const [text, setText] = useState('');
  const [choices, setChoices] = useState<readonly ProductSummary[]>([]);
  const [pin, setPin] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [isChangingPrice, setIsChangingPrice] = useState(false);
  const [isAdjusting, setIsAdjusting] = useState(false);
  const { isBusy, message, setMessage, run } = useAction();

  const show = (loaded: ProductPanelDetail): void => {
    setProduct(loaded);
    setValues(formValuesOf(loaded));
    setProblems({});
    setChoices([]);
    setPin('');
  };

  const load = (productId: string): void =>
    run(async () => {
      const loaded = await productApi.getProductDetail(productId);
      if (loaded === null) {
        setMessage('El producto ya no está en el catálogo.');
        return;
      }
      show(loaded);
    });

  useEffect(() => {
    if (initialProduct !== null) {
      load(initialProduct.id);
    }
    // The first product is loaded once, when the panel opens.
  }, []);

  const search = (): void => {
    if (text.trim() === '') {
      return;
    }
    run(async () => {
      const found = await productApi.findProducts(text);
      if (found.length === 0) {
        setMessage('No hay ningún producto con eso.');
      } else if (found.length === 1) {
        const loaded = await productApi.getProductDetail(found[0]!.id);
        if (loaded !== null) {
          show(loaded);
        }
      } else {
        setChoices(found);
      }
    });
  };

  const change = (patch: Partial<ProductFormValues>): void => {
    setValues((previous) => (previous === null ? previous : { ...previous, ...patch }));
    setProblems((previous) => {
      const kept: { -readonly [Box in keyof ProductFormProblems]: ProductFormProblems[Box] } = { ...previous };
      for (const box of Object.keys(patch)) {
        delete kept[box as keyof ProductFormProblems];
      }
      return kept;
    });
    setMessage(null);
    setNote(null);
  };

  const findCodeOwner = async (code: string): Promise<string | null> => {
    const owner = await posApi.findProductByCode(code);
    return owner === null || owner.id === product?.id ? null : owner.name;
  };

  const save = (): void => {
    if (product === null || values === null) {
      return;
    }
    const reading = readEditForm(values);
    if (!reading.ok) {
      setProblems(reading.problems);
      setMessage('Revisa lo marcado en rojo.');
      return;
    }
    if (!isOwner && pin === '') {
      setMessage('Pídele al dueño que escriba su PIN.');
      return;
    }
    run(async () => {
      const result = await productApi.updateProduct({
        productId: product.id,
        expectedRevision: product.revision,
        ...reading.changes,
        ...(isOwner ? {} : { ownerPin: pin }),
      });
      if (result.status === 'updated') {
        show(result.product);
        setNote('Listo. Los cambios quedaron guardados con tu nombre y el valor anterior.');
        return;
      }
      if (result.status === 'stale' || result.status === 'unchanged') {
        show(result.product);
      } else {
        setPin('');
      }
      if (result.status === 'unit_locked') {
        change({ unit: product.unit });
      }
      setMessage(describeResult(result));
    });
  };

  const reload = (note: string): void =>
    run(async () => {
      if (product === null) {
        return;
      }
      const loaded = await productApi.getProductDetail(product.id);
      if (loaded !== null) {
        show(loaded);
        setNote(note);
      }
    });

  const openPriceChange = pricingApi === undefined || product === null || !product.isActive ? undefined : (): void => setIsChangingPrice(true);
  const openAdjust = product === null ? undefined : (): void => setIsAdjusting(true);

  // While a dialog opened from here is open it has the keyboard, so these keys wait.
  useWindowKeys(
    { F2: product === null ? undefined : save, F8: openPriceChange, F9: openAdjust, Escape: onClose },
    isBusy || isChangingPrice || isAdjusting,
  );

  return (
    <ModalDialog titleId="product-panel-title" className="cash">
      <h2 id="product-panel-title">{product === null ? 'Producto' : product.name}</h2>
      {product === null || values === null ? (
        <>
          <p>Busca el producto por su código o por su nombre, y oprime Enter. También aparecen los que ya diste de baja.</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              search();
            }}
          >
            <Field label="Producto" value={text} onChange={setText} autoFocus maxLength={100} onEnter={search} />
          </form>
          {choices.length > 0 && (
            <ul className="cash-actions" aria-label="Productos encontrados">
              {choices.map((choice) => (
                <li key={choice.id}>
                  <button type="button" className="button" disabled={isBusy} onClick={() => load(choice.id)}>
                    {choice.name} · {formatUnitPriceE4(choice.unitPriceE4)} / {unitLabel(choice.unit)}
                    {choice.isActive ? '' : ' · dado de baja'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          {!product.isActive && (
            <p className="notice" role="status">
              Este producto está dado de baja: no se vende ni aparece en la venta. Márcalo «A la venta» y guarda para activarlo otra vez.
            </p>
          )}
          <dl className="product-summary" aria-label="Resumen del producto">
            <div>
              <dt>Existencia</dt>
              <dd>{product.stockMilli < 0 ? signed(product.stockMilli, product.unit) : formatQuantity({ milli: product.stockMilli, unit: product.unit })}</dd>
            </div>
            <div>
              <dt>Precio (IVA incluido)</dt>
              <dd>
                {formatUnitPriceE4(product.unitPriceE4)} · {formatTaxLabel(product.taxRate)}
              </dd>
            </div>
            <div>
              <dt>Costo</dt>
              <dd>{product.effectiveCostE6 === null ? 'Sin costo' : formatUnitCost(product.effectiveCostE6)}</dd>
            </div>
            <div>
              <dt>Margen</dt>
              <dd>{describeMargin(product).replace('Margen: ', '')}</dd>
            </div>
          </dl>
          {product.recentMovements.length > 0 && (
            <table aria-label="Últimos movimientos">
              <thead>
                <tr>
                  <th scope="col">Cuándo</th>
                  <th scope="col">Qué</th>
                  <th scope="col">Cantidad</th>
                  <th scope="col">Quedó</th>
                </tr>
              </thead>
              <tbody>
                {product.recentMovements.slice(0, SHOWN_MOVEMENTS).map((row, index) => (
                  <tr key={`${row.occurredAt}-${index}`}>
                    <td>{formatSaleMoment(row.occurredAt)}</td>
                    <td>{MOVEMENT_LABELS[row.type] ?? row.type}</td>
                    <td>{signed(row.quantityMilli, product.unit)}</td>
                    <td>{signed(row.balanceMilli, product.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <ProductFields
            key={`${product.id}-${product.revision}`}
            values={values}
            problems={problems}
            onChange={change}
            findCodeOwner={findCodeOwner}
            showPrice={false}
            showStock={false}
            unitLockedReason={product.movementCount > 0 ? 'No se puede cambiar: el producto ya tiene movimientos de existencia.' : undefined}
            currentTaxRate={product.taxRate}
            activeLabel={product.isActive ? 'A la venta (quita la marca para darlo de baja)' : 'A la venta (márcalo para activarlo otra vez)'}
          />
          {!isOwner && <Field label="PIN del dueño" value={pin} onChange={setPin} type="password" maxLength={8} />}
        </>
      )}
      {note !== null && (
        <p className="notice notice-info" role="status">
          {note}
        </p>
      )}
      <Message text={message} />
      {isChangingPrice && pricingApi !== undefined && product !== null && (
        <PriceChangeDialog
          posApi={posApi}
          pricingApi={pricingApi}
          isOwner={isOwner}
          initialProduct={{ id: product.id }}
          onChanged={(changed, previousUnitPriceE4) => {
            setIsChangingPrice(false);
            reload(`Precio cambiado: ${formatUnitPriceE4(previousUnitPriceE4)} → ${formatUnitPriceE4(changed.unitPriceE4)}. Quedó guardado con tu nombre.`);
          }}
          onCancel={() => setIsChangingPrice(false)}
        />
      )}
      {isAdjusting && product !== null && (
        <StockAdjustDialog
          posApi={posApi}
          productId={product.id}
          productName={product.name}
          unit={product.unit}
          isOwner={isOwner}
          onAdjusted={() => {
            setIsAdjusting(false);
            reload('Existencia ajustada. Quedó guardado con tu nombre y el motivo.');
          }}
          onCancel={() => setIsAdjusting(false)}
        />
      )}
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={onClose}>
          Cerrar <kbd>Esc</kbd>
        </button>
        {openPriceChange !== undefined && (
          <button type="button" className="button" tabIndex={-1} onClick={openPriceChange}>
            Cambiar precio <kbd>F8</kbd>
          </button>
        )}
        {openAdjust !== undefined && (
          <button type="button" className="button" tabIndex={-1} onClick={openAdjust}>
            Ajustar existencia <kbd>F9</kbd>
          </button>
        )}
        {product !== null && (
          <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={save}>
            Guardar cambios <kbd>F2</kbd>
          </button>
        )}
      </div>
    </ModalDialog>
  );
}
