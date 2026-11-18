import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { formatUnitCost, readUnitCost } from '../../shared/product-admin';
import { formatFolio, MAX_SUPPLIER_CODE_LENGTH, type OrderMoreResult, type PurchasingApi, type Supplier, type SupplierProductLink } from '../../shared/supplier-order';
import { formatQuantity } from '../sale/format';
import { Field, Message, SelectField, useAction } from '../ui/form-parts';

interface ProductSuppliersProps {
  readonly api: PurchasingApi;
  readonly productId: string;
  readonly unit: Parameters<typeof formatQuantity>[0]['unit'];
  /** The first barcode of the product, offered as the code when the supplier uses the same one. */
  readonly barcode: string | null;
  readonly isOwner: boolean;
  /** The PIN of the owner a cashier typed in the panel. */
  readonly ownerPin: string;
}

/** Says in words why «Pedir más» did not add the product. */
function refusalText(result: Exclude<OrderMoreResult, { status: 'added' }>): string {
  switch (result.status) {
    case 'already_in_order':
      return `Ya está en el pedido ${formatFolio(result.order.folio)} de ${result.order.supplierName}. Cambia la cantidad desde Pedido.`;
    case 'full':
      return 'El borrador de ese proveedor ya está lleno. Envíalo o empieza otro desde Pedido.';
    case 'authorization_required':
      return 'Pídele al dueño que escriba su PIN en el panel.';
    case 'wrong_pin':
      return `PIN incorrecto. Quedan ${String(result.attemptsLeft)} intentos.`;
    case 'locked':
      return 'Demasiados intentos con el PIN. Espera unos minutos.';
    case 'stale':
      return 'El pedido cambió en otra pantalla. Intenta de nuevo.';
    default:
      return 'No se encontró el producto o el proveedor. Revisa que sigan activos.';
  }
}

/**
 * The suppliers of a product inside its panel (E1-50, ADR 0064): every supplier that sells it, with its code and list
 * cost, as many as there are. A green «Pedir más» adds the product to the draft order of that supplier, and a short form
 * links one more supplier.
 *
 * @param props.api the bridge of the orders
 * @param props.productId the product of the panel
 * @param props.unit its unit, to say the quantity that was ordered
 * @param props.barcode its first barcode
 * @param props.isOwner whether the person is the owner
 * @param props.ownerPin the PIN a cashier typed in the panel
 * @returns the section
 */
export function ProductSuppliers({ api, productId, unit, barcode, isOwner, ownerPin }: ProductSuppliersProps): ReactElement {
  const [links, setLinks] = useState<readonly SupplierProductLink[]>([]);
  const [suppliers, setSuppliers] = useState<readonly Supplier[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [code, setCode] = useState(barcode ?? '');
  const [cost, setCost] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const { isBusy, message, setMessage, run } = useAction();
  const pinPart = isOwner || ownerPin === '' ? {} : { ownerPin };

  const refresh = useCallback(() => {
    Promise.all([api.getSupplierLinks(productId), api.listSuppliers(false)]).then(
      ([found, active]) => {
        setLinks(found);
        setSuppliers(active);
      },
      () => setMessage('No se pudieron leer los proveedores.'),
    );
  }, [api, productId, setMessage]);

  useEffect(refresh, [refresh]);

  const unlinked = suppliers.filter((supplier) => !links.some((link) => link.supplierId === supplier.id));
  const chosen = unlinked.some((supplier) => supplier.id === supplierId) ? supplierId : (unlinked[0]?.id ?? '');

  const orderMore = (link: SupplierProductLink): void => {
    run(async () => {
      const result = await api.orderMore({ productId, supplierId: link.supplierId, ...pinPart });
      if (result.status === 'added') {
        setInfo(`Agregado al pedido ${formatFolio(result.order.folio)} de ${link.supplierName}: ${formatQuantity({ milli: result.quantityMilli, unit })}. Ajusta la cantidad desde Pedido si hace falta.`);
        return;
      }
      setInfo(null);
      setMessage(refusalText(result));
    });
  };

  const link = (): void => {
    const reading = cost.trim() === '' ? null : readUnitCost(cost);
    if (reading !== null && !reading.ok) {
      setMessage(reading.message);
      return;
    }
    if (chosen === '' || code.trim() === '') {
      setMessage('Elige el proveedor y escribe el código con el que él lo vende.');
      return;
    }
    run(async () => {
      const result = await api.setSupplierCodes({
        supplierId: chosen,
        productId,
        codes: [{ supplierCode: code.trim(), listCostE6: reading === null ? null : reading.unitCostE6, purchaseUnit: null }],
        ...pinPart,
      });
      if (result.status === 'saved' || result.status === 'unchanged') {
        setLinks(result.links);
        setInfo('Proveedor agregado al producto.');
        setCost('');
        return;
      }
      setMessage(result.status === 'authorization_required' ? 'Pídele al dueño que escriba su PIN en el panel.' : result.status === 'wrong_pin' ? 'PIN incorrecto.' : 'No se pudo agregar el proveedor.');
    });
  };

  return (
    <section className="product-suppliers" aria-label="Proveedores del producto">
      <h3>Proveedores</h3>
      {links.length === 0 ? (
        <p className="dialog-hint">Ningún proveedor tiene este producto todavía. Agrega uno abajo para poder pedirlo.</p>
      ) : (
        <ul className="product-suppliers-list scroll-area" aria-label="Proveedores que lo venden">
          {links.map((row) => (
            <li key={row.supplierId}>
              <div>
                <strong>{row.supplierName}</strong>
                <small>
                  {row.codes.map((entry) => `${entry.supplierCode}${entry.listCostE6 === null ? '' : ` · ${formatUnitCost(entry.listCostE6)}`}`).join(' · ')}
                </small>
              </div>
              <button type="button" className="button button-good" tabIndex={-1} disabled={isBusy} onClick={() => orderMore(row)}>
                Pedir más
              </button>
            </li>
          ))}
        </ul>
      )}
      {unlinked.length > 0 && (
        <div className="product-suppliers-add">
          <SelectField label="Agregar proveedor" value={chosen} onChange={setSupplierId} options={unlinked.map((supplier) => ({ value: supplier.id, label: supplier.name }))} />
          <Field label="Código del proveedor" value={code} onChange={setCode} maxLength={MAX_SUPPLIER_CODE_LENGTH} />
          <Field label="Costo de lista (opcional)" value={cost} onChange={setCost} numeric="decimal" maxLength={14} />
          <button type="button" className="button" tabIndex={-1} disabled={isBusy} onClick={link}>
            Agregar proveedor
          </button>
        </div>
      )}
      <Message text={message} />
      {info !== null && (
        <p className="notice notice-info" role="status">
          {info}
        </p>
      )}
    </section>
  );
}
