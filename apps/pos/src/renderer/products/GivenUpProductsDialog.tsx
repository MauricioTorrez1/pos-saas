import { formatUnitPriceE4 } from '@pos-saas/money';
import { useEffect, useState, type ReactElement } from 'react';

import { formatUnitCost, type GivenUpListResult, type GivenUpProduct, type ProductAdminApi } from '../../shared/product-admin';
import { formatQuantity, formatSaleMoment } from '../sale/format';
import { Field, Message, useAction } from '../ui/form-parts';
import { ModalDialog } from '../ui/ModalDialog';
import { useWindowKeys } from '../ui/use-window-keys';
import { ReactivateProductDialog } from './ReactivateProductDialog';

/** What to tell the person when the list was not shown. */
function describeRefusal(result: Exclude<GivenUpListResult, { status: 'listed' }>): string {
  switch (result.status) {
    case 'authorization_required':
      return 'Pídele al dueño que escriba su PIN.';
    case 'wrong_pin':
      return `PIN del dueño incorrecto. Quedan ${result.attemptsLeft} intentos. Quedó anotado en la bitácora.`;
    case 'locked':
      return 'Demasiados intentos con el PIN del dueño. Espera unos minutos. Quedó anotado en la bitácora.';
  }
}

/** The stock as people read it, with a minus sign when the ledger went below zero. */
function stockText({ stockMilli, unit }: GivenUpProduct): string {
  const text = formatQuantity({ milli: Math.abs(stockMilli), unit });
  return stockMilli < 0 ? `−${text}` : text;
}

/** Whether a product matches what was typed: part of its name, or part of a code it released. */
function matches(product: GivenUpProduct, text: string): boolean {
  const wanted = text.trim().toLocaleLowerCase('es-MX');
  return wanted === '' || product.name.toLocaleLowerCase('es-MX').includes(wanted) || product.releasedCodes.some((code) => code.toLocaleLowerCase('es-MX').includes(wanted));
}

interface GivenUpProductsDialogProps {
  readonly productApi: ProductAdminApi;
  /** The owner sees the list at once, and a cashier types the PIN of an owner first. */
  readonly isOwner: boolean;
  readonly onClose: () => void;
}

/**
 * The products that were given up (E1-62, ADR 0081): when and by whom, their last price and cost, the stock they left and the
 * codes they released, with a filter by name or code and «Reactivar» on each one. A stock other than zero is marked, because
 * that merchandise still counts in the inventory. Only the owner, or a cashier with the PIN of an owner, which is asked once.
 *
 * @param props.productApi bridge that lists and reactivates products
 * @param props.isOwner whether the person at the register is the owner
 * @param props.onClose called when the person closes the list
 * @returns the dialog
 */
export function GivenUpProductsDialog({ productApi, isOwner, onClose }: GivenUpProductsDialogProps): ReactElement {
  const [products, setProducts] = useState<readonly GivenUpProduct[] | null>(null);
  const [pin, setPin] = useState('');
  const [approvedPin, setApprovedPin] = useState<string | undefined>(undefined);
  const [filter, setFilter] = useState('');
  const [reactivating, setReactivating] = useState<GivenUpProduct | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { isBusy, message, setMessage, run } = useAction();

  const load = (ownerPin: string | undefined): void =>
    run(async () => {
      const result = await productApi.listGivenUpProducts(ownerPin);
      if (result.status !== 'listed') {
        setPin('');
        setMessage(describeRefusal(result));
        return;
      }
      setApprovedPin(ownerPin);
      setProducts(result.products);
    });

  useEffect(() => {
    if (isOwner) {
      load(undefined);
    }
    // The list is read once when the dialog opens; a reactivation reads it again.
  }, []);

  const askWithPin = (): void => {
    if (pin === '') {
      setMessage('Pídele al dueño que escriba su PIN.');
      return;
    }
    load(pin);
  };

  useWindowKeys({ Escape: onClose }, isBusy || reactivating !== null);

  const shown = products?.filter((product) => matches(product, filter)) ?? [];

  return (
    <ModalDialog titleId="given-up-title" className="cash given-up">
      <h2 id="given-up-title">Productos dados de baja</h2>
      {products === null ? (
        !isOwner && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              askWithPin();
            }}
          >
            <p>Solo el dueño puede ver esta lista. Pídele que escriba su PIN.</p>
            <Field label="PIN del dueño" numeric="integer" value={pin} onChange={setPin} type="password" maxLength={8} autoFocus onEnter={askWithPin} />
          </form>
        )
      ) : (
        <>
          <p>
            Sus códigos quedaron libres para otros productos. «Reactivar» lo vuelve a poner a la venta y recupera los códigos que nadie
            más usa.
          </p>
          <Field label="Buscar dados de baja" value={filter} onChange={setFilter} autoFocus maxLength={100} hint="Por nombre o por código." />
          {shown.length === 0 ? (
            <p>{products.length === 0 ? 'No hay productos dados de baja.' : 'Ningún producto dado de baja coincide.'}</p>
          ) : (
            <table aria-label="Productos dados de baja">
              <thead>
                <tr>
                  <th scope="col">Producto</th>
                  <th scope="col">Dado de baja</th>
                  <th scope="col">Último precio</th>
                  <th scope="col">Costo</th>
                  <th scope="col">Existencia</th>
                  <th scope="col">Códigos liberados</th>
                  <th scope="col">
                    <span className="visually-hidden">Acción</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((product) => (
                  <tr key={product.id}>
                    <th scope="row">{product.name}</th>
                    <td>
                      {product.givenUpAt === null ? 'Sin fecha' : formatSaleMoment(product.givenUpAt)}
                      {product.givenUpByName !== null && ` · ${product.givenUpByName}`}
                    </td>
                    <td>{formatUnitPriceE4(product.unitPriceE4)}</td>
                    <td>{product.effectiveCostE6 === null ? 'Sin costo' : formatUnitCost(product.effectiveCostE6)}</td>
                    <td>
                      {product.stockMilli === 0 ? (
                        stockText(product)
                      ) : (
                        <span className="notice notice-warn">Le quedan {stockText(product)}: ajusta el inventario si ya no las tienes.</span>
                      )}
                    </td>
                    <td>{product.releasedCodes.length === 0 ? 'Ninguno' : product.releasedCodes.join(', ')}</td>
                    <td>
                      <button type="button" className="button" tabIndex={-1} disabled={isBusy} onClick={() => setReactivating(product)}>
                        Reactivar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {products.length > 0 && (
            <p>
              {products.length} producto{products.length === 1 ? '' : 's'} dado{products.length === 1 ? '' : 's'} de baja.
            </p>
          )}
        </>
      )}
      {note !== null && (
        <p className="notice notice-info" role="status">
          {note}
        </p>
      )}
      <Message text={message} />
      {reactivating !== null && (
        <ReactivateProductDialog
          productApi={productApi}
          productId={reactivating.id}
          isOwner={isOwner}
          onReactivated={(product) => {
            setReactivating(null);
            setNote(`«${product.name}» está a la venta otra vez${product.barcodes.length === 0 ? ', sin códigos' : ` con ${product.barcodes.join(', ')}`}.`);
            load(approvedPin);
          }}
          onCancel={() => setReactivating(null)}
        />
      )}
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={onClose}>
          Cerrar <kbd>Esc</kbd>
        </button>
        {products === null && !isOwner && (
          <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={askWithPin}>
            Ver la lista
          </button>
        )}
      </div>
    </ModalDialog>
  );
}
