import { formatUnitPriceE4 } from '@pos-saas/money';
import { useEffect, useState, type ReactElement } from 'react';

import type { CatalogProduct, PosApi } from '../../shared/pos-api';
import { marginBasisPoints, type ChangePriceResult, type PriceInfo, type PricingApi } from '../../shared/pricing';
import { unitLabel } from '../sale/format';
import { Field, Message, useAction } from '../ui/form-parts';
import { ModalDialog } from '../ui/ModalDialog';
import { useWindowKeys } from '../ui/use-window-keys';
import { formatBasisPoints, readNewPrice } from './price-input';

const MAX_CHOICES = 20;

/** What to tell the person for each way a change can be refused. The `changed` case is not here: it closes the dialog. */
function describeRefusal(result: Exclude<ChangePriceResult, { status: 'changed' }>): string {
  switch (result.status) {
    case 'unchanged':
      return 'Ese ya es el precio del producto. No se cambió nada.';
    case 'not_found':
      return 'El producto ya no está en el catálogo.';
    case 'stale':
      return `El precio cambió mientras lo editabas: ahora es ${formatUnitPriceE4(result.product.unitPriceE4)}. Revísalo y vuelve a intentar.`;
    case 'authorization_required':
      return 'Pídele al dueño que escriba su PIN.';
    case 'wrong_pin':
      return `PIN del dueño incorrecto. Quedan ${result.attemptsLeft} intentos. Quedó anotado en la bitácora.`;
    case 'locked':
      return 'Demasiados intentos con el PIN del dueño. Espera unos minutos. Quedó anotado en la bitácora.';
  }
}

/** How the margin of a price reads, or why it cannot be read. */
function describeMargin(info: PriceInfo, unitPriceE4: number): string {
  if (info.lastCostE6 === null) {
    return 'Sin costo registrado: no se puede calcular el margen.';
  }
  const margin = marginBasisPoints(unitPriceE4, info.product.taxRate, info.lastCostE6);
  return margin === null ? 'No se puede calcular el margen.' : `Margen: ${formatBasisPoints(margin)}`;
}

interface PriceChangeDialogProps {
  readonly posApi: PosApi;
  readonly pricingApi: PricingApi;
  /** The owner needs no PIN, and a cashier has to type the one of an owner. */
  readonly isOwner: boolean;
  /** The product whose price changes. Without it, the dialog asks for one first. */
  readonly initialProduct: Pick<CatalogProduct, 'id'> | null;
  /** Called after the price was changed, with the product as it is now and the price it had. */
  readonly onChanged: (product: CatalogProduct, previousUnitPriceE4: number) => void;
  readonly onCancel: () => void;
}

/**
 * Changes the price of a product that is already in the catalog (E1-39). It finds the product, shows the current price and
 * the margin, and shows how the new price compares before asking to save. A cashier has to type the PIN of the owner, and
 * every attempt, good or bad, stays in the audit log. A sale being rung up keeps the prices of its lines.
 *
 * @param props.posApi bridge to the main process, to find the product
 * @param props.pricingApi bridge for the price itself
 * @param props.isOwner whether the person at the register is the owner
 * @param props.initialProduct the product to change, if the screen already knows it
 * @param props.onChanged called once the new price is saved
 * @param props.onCancel called when the person gives up
 * @returns the dialog
 */
export function PriceChangeDialog({ posApi, pricingApi, isOwner, initialProduct, onChanged, onCancel }: PriceChangeDialogProps): ReactElement {
  const [info, setInfo] = useState<PriceInfo | null>(null);
  const [text, setText] = useState('');
  const [choices, setChoices] = useState<readonly CatalogProduct[]>([]);
  const [price, setPrice] = useState('');
  const [pin, setPin] = useState('');
  const { isBusy, message, setMessage, run } = useAction();

  const load = (productId: string): void =>
    run(async () => {
      const loaded = await pricingApi.getPriceInfo(productId);
      if (loaded === null) {
        setMessage('El producto ya no está en el catálogo.');
        return;
      }
      setInfo(loaded);
      setChoices([]);
      setPrice('');
    });

  useEffect(() => {
    if (initialProduct !== null) {
      load(initialProduct.id);
    }
    // The first product is loaded once, when the dialog opens.
  }, []);

  const search = (): void => {
    if (text.trim() === '') {
      return;
    }
    run(async () => {
      const exact = await posApi.findProductByCode(text);
      const found = exact === null ? await posApi.searchProducts(text) : [exact];
      if (found.length === 0) {
        setMessage('No hay ningún producto con eso.');
      } else if (found.length === 1) {
        const loaded = await pricingApi.getPriceInfo(found[0]!.id);
        setInfo(loaded);
        setChoices([]);
        setPrice('');
      } else {
        setChoices(found.slice(0, MAX_CHOICES));
      }
    });
  };

  const save = (): void => {
    if (info === null) {
      return;
    }
    const reading = readNewPrice(price);
    if (!reading.ok) {
      setMessage(reading.message);
      return;
    }
    if (!isOwner && pin === '') {
      setMessage('Pídele al dueño que escriba su PIN.');
      return;
    }
    run(async () => {
      const result = await pricingApi.changePrice({
        productId: info.product.id,
        previousUnitPriceE4: info.product.unitPriceE4,
        newUnitPriceE4: reading.unitPriceE4,
        ...(isOwner ? {} : { ownerPin: pin }),
      });
      if (result.status === 'changed') {
        onChanged(result.product, result.previousUnitPriceE4);
        return;
      }
      setPin('');
      if (result.status === 'stale') {
        setInfo({ ...info, product: result.product });
      }
      setMessage(describeRefusal(result));
    });
  };

  useWindowKeys({ F2: info === null ? undefined : save, Escape: onCancel }, isBusy);

  const reading = readNewPrice(price);

  return (
    <ModalDialog titleId="price-title" className="cash">
      <h2 id="price-title">Cambiar precio</h2>
      {info === null ? (
        <>
          <p>Busca el producto por su código o por su nombre, y oprime Enter.</p>
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
              {choices.map((product) => (
                <li key={product.id}>
                  <button type="button" className="button" disabled={isBusy} onClick={() => load(product.id)}>
                    {product.name} · {formatUnitPriceE4(product.unitPriceE4)} / {unitLabel(product.unit)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <p className="quantity-price">
            <strong>{info.product.name}</strong>
          </p>
          <p>
            Precio actual: <strong>{formatUnitPriceE4(info.product.unitPriceE4)}</strong> por {unitLabel(info.product.unit)}, con IVA incluido. {describeMargin(info, info.product.unitPriceE4)}
          </p>
          <Field label="Precio nuevo (IVA incluido)" value={price} onChange={setPrice} autoFocus maxLength={14} hint="En pesos, por ejemplo 135.50" />
          {reading.ok && reading.unitPriceE4 !== info.product.unitPriceE4 && (
            <p className="notice notice-info" role="status">
              Antes {formatUnitPriceE4(info.product.unitPriceE4)} → ahora {formatUnitPriceE4(reading.unitPriceE4)}. {describeMargin(info, reading.unitPriceE4)}
              {info.lastCostE6 !== null && (marginBasisPoints(reading.unitPriceE4, info.product.taxRate, info.lastCostE6) ?? 0) < 0 ? ' Ojo: queda por debajo del costo.' : ''}
            </p>
          )}
          {!isOwner && <Field label="PIN del dueño" value={pin} onChange={setPin} type="password" maxLength={8} />}
          <p>La venta que ya tienes armada conserva los precios de sus productos. Las ventas ya cobradas no cambian.</p>
        </>
      )}
      <Message text={message} />
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={onCancel}>
          Cancelar <kbd>Esc</kbd>
        </button>
        {info !== null && (
          <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={save}>
            Guardar precio <kbd>F2</kbd>
          </button>
        )}
      </div>
    </ModalDialog>
  );
}
