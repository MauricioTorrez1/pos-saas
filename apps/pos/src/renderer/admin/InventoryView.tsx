import { formatUnitPriceE4, MoneyError, parseQuantity } from '@pos-saas/money';
import { useState, type ReactElement } from 'react';

import type { Kardex } from '../../shared/inventory-api';
import type { CatalogProduct, PosApi } from '../../shared/pos-api';
import type { PricingApi } from '../../shared/pricing';
import type { ProductAdminApi } from '../../shared/product-admin';
import { PriceChangeDialog } from '../pricing/PriceChangeDialog';
import { ProductPanelDialog } from '../products/ProductPanelDialog';
import { formatQuantity } from '../sale/format';
import { Field, Message, useAction } from '../ui/form-parts';
import { useWindowKeys } from '../ui/use-window-keys';
import { MOVEMENT_LABELS, STOCK_KINDS, type StockKind } from './stock-kinds';

const MOMENT = new Intl.DateTimeFormat('es-MX', { dateStyle: 'short', timeStyle: 'short' });

interface InventoryViewProps {
  readonly posApi: PosApi;
  /** The prices of the catalog. Without it, the product view offers no price change. */
  readonly pricingApi?: PricingApi;
  /** Finding and editing products. Without it, the view of a product offers no panel. */
  readonly productApi?: ProductAdminApi;
  readonly onBack: () => void;
}

/**
 * The inventory of one product for the owner: its history with the balance after each movement, and a form to correct a
 * count or write off a loss. Everything is typed, and the keys are shown on the buttons.
 *
 * @param props.posApi bridge to the main process
 * @param props.pricingApi bridge for changing the price of the product, when the register offers it
 * @param props.productApi bridge for the product panel, when the register offers it
 * @param props.onBack called to go back to the administration summary
 * @returns the view
 */
export function InventoryView({ posApi, pricingApi, productApi, onBack }: InventoryViewProps): ReactElement {
  const [text, setText] = useState('');
  const [found, setFound] = useState<readonly CatalogProduct[]>([]);
  const [kardex, setKardex] = useState<Kardex | null>(null);
  const [isChangingPrice, setIsChangingPrice] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const { isBusy, message, setMessage, run } = useAction();

  const search = (): void => {
    if (text.trim() === '') {
      return;
    }
    run(async () => {
      const exact = await posApi.findProductByCode(text);
      const products = exact === null ? await posApi.searchProducts(text) : [exact];
      setFound(products);
      if (products.length === 0) {
        setMessage('No hay ningún producto con eso.');
      } else if (products.length === 1) {
        setKardex(await posApi.getKardex(products[0]!.id));
      }
    });
  };

  const open = (productId: string): void =>
    run(async () => {
      setKardex(await posApi.getKardex(productId));
    });

  useWindowKeys({ Escape: kardex === null ? onBack : () => setKardex(null) }, isBusy || isChangingPrice || isEditing);

  if (kardex !== null) {
    return (
      <KardexView
        posApi={posApi}
        {...(pricingApi === undefined ? {} : { pricingApi })}
        {...(productApi === undefined ? {} : { productApi })}
        isChangingPrice={isChangingPrice}
        setIsChangingPrice={setIsChangingPrice}
        isEditing={isEditing}
        setIsEditing={setIsEditing}
        kardex={kardex}
        onChange={setKardex}
        onBack={() => setKardex(null)}
      />
    );
  }
  return (
    <>
      <h2 id="admin-title">Inventario</h2>
      <p>Busca un producto por su código o por su nombre, y oprime Enter.</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          search();
        }}
      >
        <Field label="Producto" value={text} onChange={setText} autoFocus maxLength={100} onEnter={search} />
      </form>
      <Message text={message} />
      {found.length > 1 && (
        <ul className="cash-actions" aria-label="Productos encontrados">
          {found.map((product) => (
            <li key={product.id}>
              <button type="button" className="button" disabled={isBusy} onClick={() => open(product.id)}>
                {product.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="button" tabIndex={-1} onClick={onBack}>
        Volver <kbd>Esc</kbd>
      </button>
    </>
  );
}

interface KardexViewProps {
  readonly posApi: PosApi;
  readonly pricingApi?: PricingApi;
  readonly productApi?: ProductAdminApi;
  /** Lives in the parent, because the key that goes back to the search must also wait while the price dialog is open. */
  readonly isChangingPrice: boolean;
  readonly setIsChangingPrice: (isChangingPrice: boolean) => void;
  /** Lives in the parent for the same reason: the key that goes back must also wait while the product panel is open. */
  readonly isEditing: boolean;
  readonly setIsEditing: (isEditing: boolean) => void;
  readonly kardex: Kardex;
  readonly onChange: (kardex: Kardex) => void;
  readonly onBack: () => void;
}

function KardexView({ posApi, pricingApi, productApi, isChangingPrice, setIsChangingPrice, isEditing, setIsEditing, kardex, onChange, onBack }: KardexViewProps): ReactElement {
  const [kind, setKind] = useState<StockKind>('waste');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const { isBusy, message, setMessage, run } = useAction();

  const save = (): void => {
    let milli: number;
    try {
      milli = parseQuantity(quantity, kardex.unit).milli;
    } catch (error) {
      setMessage(error instanceof MoneyError ? 'La cantidad no es válida. Usa números, con hasta 3 decimales (las piezas son enteras).' : 'No se pudo leer la cantidad.');
      return;
    }
    if (milli === 0) {
      setMessage('La cantidad debe ser mayor que cero.');
      return;
    }
    if (reason.trim() === '') {
      setMessage('Escribe el motivo: se queda guardado en la bitácora.');
      return;
    }
    const { type, sign } = STOCK_KINDS[kind];
    run(async () => {
      const result = await posApi.adjustStock({ productId: kardex.productId, type, quantityMilli: sign * milli, reason });
      if (result.status === 'recorded') {
        onChange(result.kardex);
        setQuantity('');
        setReason('');
        setNote('Listo. Quedó guardado con tu nombre y el motivo.');
      } else {
        setMessage('No se pudo registrar el movimiento.');
      }
    });
  };

  const openPriceChange = pricingApi === undefined ? undefined : (): void => setIsChangingPrice(true);
  const openProductPanel = productApi === undefined ? undefined : (): void => setIsEditing(true);

  // While the price dialog is open it has the keyboard, so these keys wait.
  useWindowKeys({ F2: save, F5: () => setKind('waste'), F6: () => setKind('surplus'), F7: () => setKind('shortage'), F8: openPriceChange, F9: openProductPanel }, isBusy || isChangingPrice || isEditing);

  return (
    <>
      <h2 id="admin-title">{kardex.productName}</h2>
      <p className="quantity-price">
        Existencia: <strong>{kardex.stockMilli < 0 ? signed(kardex.stockMilli, kardex.unit) : formatQuantity({ milli: kardex.stockMilli, unit: kardex.unit })}</strong>
      </p>
      <table aria-label="Movimientos del producto">
        <thead>
          <tr>
            <th scope="col">Cuándo</th>
            <th scope="col">Qué</th>
            <th scope="col">Cantidad</th>
            <th scope="col">Quedó</th>
          </tr>
        </thead>
        <tbody>
          {kardex.rows.map((row, index) => (
            <tr key={`${row.occurredAt}-${index}`}>
              <td>{MOMENT.format(new Date(row.occurredAt))}</td>
              <td>{MOVEMENT_LABELS[row.type] ?? row.type}</td>
              <td>{signed(row.quantityMilli, kardex.unit)}</td>
              <td>{signed(row.balanceMilli, kardex.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {kardex.totalMovements > kardex.rows.length && <p>Se muestran los {kardex.rows.length} movimientos más recientes de {kardex.totalMovements}.</p>}
      <fieldset>
        <legend>Qué pasó</legend>
        <p>
          <strong>{STOCK_KINDS[kind].label}</strong>
        </p>
        <p>
          <kbd>F5</kbd> Merma · <kbd>F6</kbd> Sobrante · <kbd>F7</kbd> Faltante
        </p>
      </fieldset>
      <Field label="Cantidad" value={quantity} onChange={setQuantity} autoFocus maxLength={12} hint="Sin signo: la caja lo pone según lo que elegiste." />
      <Field label="Motivo" value={reason} onChange={setReason} maxLength={200} />
      {note !== null && (
        <p className="notice notice-info" role="status">
          {note}
        </p>
      )}
      <Message text={message} />
      {isChangingPrice && pricingApi !== undefined && (
        <PriceChangeDialog
          posApi={posApi}
          pricingApi={pricingApi}
          isOwner
          initialProduct={{ id: kardex.productId }}
          onChanged={(product, previousUnitPriceE4) => {
            setIsChangingPrice(false);
            setNote(`Precio cambiado: ${formatUnitPriceE4(previousUnitPriceE4)} → ${formatUnitPriceE4(product.unitPriceE4)}. Quedó guardado con tu nombre.`);
          }}
          onCancel={() => setIsChangingPrice(false)}
        />
      )}
      {isEditing && productApi !== undefined && (
        <ProductPanelDialog
          posApi={posApi}
          productApi={productApi}
          {...(pricingApi === undefined ? {} : { pricingApi })}
          isOwner
          initialProduct={{ id: kardex.productId }}
          onClose={() => {
            setIsEditing(false);
            // The panel may have changed the product, its price or its stock, so the history is read again.
            posApi.getKardex(kardex.productId).then((fresh) => (fresh === null ? onBack() : onChange(fresh)), () => setMessage('No se pudo actualizar el inventario.'));
          }}
        />
      )}
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={onBack}>
          Otro producto <kbd>Esc</kbd>
        </button>
        {openPriceChange !== undefined && (
          <button type="button" className="button" tabIndex={-1} onClick={openPriceChange}>
            Cambiar precio <kbd>F8</kbd>
          </button>
        )}
        {openProductPanel !== undefined && (
          <button type="button" className="button" tabIndex={-1} onClick={openProductPanel}>
            Modificar producto <kbd>F9</kbd>
          </button>
        )}
        <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={save}>
          Registrar <kbd>F2</kbd>
        </button>
      </div>
    </>
  );
}

function signed(milli: number, unit: Kardex['unit']): string {
  const text = formatQuantity({ milli: Math.abs(milli), unit });
  return milli < 0 ? `−${text}` : milli > 0 ? `+${text}` : text;
}
