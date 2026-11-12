import { formatCents } from '@pos-saas/money';
import { useEffect, useState, type ReactElement } from 'react';

import { formatFolio, type PurchaseOrderSummary, type PurchasingApi, type Supplier } from '../../shared/supplier-order';
import { formatSaleMoment } from '../sale/format';
import { Message, useAction } from '../ui/form-parts';
import { ModalDialog } from '../ui/ModalDialog';
import { useWindowKeys } from '../ui/use-window-keys';
import { OrderEditor } from './OrderEditor';
import { SupplierManager } from './SupplierManager';

type View =
  | { readonly kind: 'list' }
  | { readonly kind: 'order'; readonly orderId: string | null }
  | { readonly kind: 'suppliers' };

interface SupplierOrderDialogProps {
  readonly api: PurchasingApi;
  /** The owner needs no PIN, and a cashier has to type the one of an owner to save, send or export. */
  readonly isOwner: boolean;
  readonly onClose: () => void;
}

/**
 * The orders to suppliers (E1-44): the drafts and the sent ones, the way to start a new order, and the suppliers. It opens
 * from the sale screen and from the administration. An order is a document of the register: it never changes the stock, and
 * it works with no internet.
 *
 * @param props.api bridge of the purchase order
 * @param props.isOwner whether the person at the register is the owner
 * @param props.onClose called when the person closes the dialog
 * @returns the dialog
 */
export function SupplierOrderDialog({ api, isOwner, onClose }: SupplierOrderDialogProps): ReactElement {
  const [view, setView] = useState<View>({ kind: 'list' });
  const [orders, setOrders] = useState<readonly PurchaseOrderSummary[] | null>(null);
  const [suppliers, setSuppliers] = useState<readonly Supplier[] | null>(null);
  const { isBusy, message, run } = useAction();

  const load = (): void =>
    run(async () => {
      const [loadedOrders, loadedSuppliers] = await Promise.all([api.listOrders(), api.listSuppliers(false)]);
      setOrders(loadedOrders);
      setSuppliers(loadedSuppliers);
    });

  useEffect(load, []);

  const backToList = (): void => {
    setView({ kind: 'list' });
    load();
  };

  useWindowKeys(
    view.kind === 'list'
      ? {
          F2: suppliers === null ? undefined : () => setView({ kind: 'order', orderId: null }),
          F3: () => setView({ kind: 'suppliers' }),
          Escape: onClose,
        }
      : {},
    isBusy,
  );

  return (
    <ModalDialog titleId="order-title" className="cash order-dialog">
      {view.kind === 'order' && suppliers !== null ? (
        <OrderEditor
          api={api}
          isOwner={isOwner}
          suppliers={suppliers}
          orderId={view.orderId}
          onManageSuppliers={() => setView({ kind: 'suppliers' })}
          onBack={backToList}
        />
      ) : view.kind === 'suppliers' ? (
        <SupplierManager api={api} isOwner={isOwner} onChanged={() => void api.listSuppliers(false).then(setSuppliers)} onBack={backToList} />
      ) : (
        <>
          <h2 id="order-title">Pedido al proveedor</h2>
          <p>Arma el pedido, guárdalo como borrador y sácalo en Excel o PDF para mandarlo por correo o WhatsApp. No mueve tu inventario: lo que llegue se registra al recibirlo.</p>
          <Message text={message} />
          {orders !== null && orders.length === 0 && <p className="order-empty">Todavía no has hecho ningún pedido.</p>}
          {orders !== null && orders.length > 0 && (
            <table className="order-lines" aria-label="Pedidos">
              <thead>
                <tr>
                  <th scope="col">Folio</th>
                  <th scope="col">Proveedor</th>
                  <th scope="col">Estado</th>
                  <th scope="col">Renglones</th>
                  <th scope="col">Total estimado</th>
                  <th scope="col">Actualizado</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td>
                      <button type="button" className="button" disabled={isBusy} onClick={() => setView({ kind: 'order', orderId: order.id })}>
                        {formatFolio(order.folio)}
                      </button>
                    </td>
                    <td>{order.supplierName}</td>
                    <td>{order.status === 'draft' ? 'Borrador' : 'Enviado'}</td>
                    <td>{order.lineCount}</td>
                    <td className="order-amount">{formatCents(order.totalCents)}</td>
                    <td>{formatSaleMoment(order.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="payment-actions">
            <button type="button" className="button" tabIndex={-1} onClick={onClose}>
              Cerrar <kbd>Esc</kbd>
            </button>
            <button type="button" className="button" tabIndex={-1} onClick={() => setView({ kind: 'suppliers' })}>
              Proveedores <kbd>F3</kbd>
            </button>
            <button type="button" className="button button-primary" tabIndex={-1} disabled={suppliers === null} onClick={() => setView({ kind: 'order', orderId: null })}>
              Pedido nuevo <kbd>F2</kbd>
            </button>
          </div>
        </>
      )}
    </ModalDialog>
  );
}
