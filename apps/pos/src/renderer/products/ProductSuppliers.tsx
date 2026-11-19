import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { formatUnitCost, readUnitCost, unitCostText } from '../../shared/product-admin';
import {
  formatFolio,
  MAX_SUPPLIER_CODE_LENGTH,
  type DraftOrderRef,
  type OrderMoreResult,
  type OwnerRefusalResult,
  type PurchasingApi,
  type Supplier,
  type SupplierCode,
  type SupplierProductLink,
} from '../../shared/supplier-order';
import { formatQuantity } from '../sale/format';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { CheckField, Field, Message, SelectField, useAction } from '../ui/form-parts';

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

/** One code of the row being changed, as the form holds it: the cost is the text that was typed. */
interface CodeDraft {
  readonly supplierCode: string;
  readonly cost: string;
  /** Kept as it was: the presentation is changed in the codes screen of the supplier. */
  readonly purchaseUnit: string | null;
}

/** The supplier row being changed inline (E1-58). */
interface RowEdit {
  readonly link: SupplierProductLink;
  readonly supplierId: string;
  readonly codes: readonly CodeDraft[];
}

/** The supplier about to be removed, with the drafts of it that have the product. */
interface RowRemoval {
  readonly link: SupplierProductLink;
  readonly drafts: readonly DraftOrderRef[];
  readonly removeFromDrafts: boolean;
}

/** Says in words why an owner's approval was not given. */
function ownerRefusalText(result: OwnerRefusalResult): string {
  switch (result.status) {
    case 'authorization_required':
      return 'Pídele al dueño que escriba su PIN en el panel.';
    case 'wrong_pin':
      return `PIN incorrecto. Quedan ${String(result.attemptsLeft)} intentos.`;
    default:
      return 'Demasiados intentos con el PIN. Espera unos minutos.';
  }
}

/** Says in words why «Pedir más» did not add the product. */
function refusalText(result: Exclude<OrderMoreResult, { status: 'added' }>): string {
  switch (result.status) {
    case 'already_in_order':
      return `Ya está en el pedido ${formatFolio(result.order.folio)} de ${result.order.supplierName}. Cambia la cantidad desde Pedido.`;
    case 'full':
      return 'El borrador de ese proveedor ya está lleno. Envíalo o empieza otro desde Pedido.';
    case 'authorization_required':
    case 'wrong_pin':
    case 'locked':
      return ownerRefusalText(result);
    case 'stale':
      return 'El pedido cambió en otra pantalla. Intenta de nuevo.';
    default:
      return 'No se encontró el producto o el proveedor. Revisa que sigan activos.';
  }
}

/** Writes the codes of a row the way the list shows them: "CIN-1 · $12.50 · CIN-2". */
function describeCodes(codes: readonly SupplierCode[]): string {
  return codes.map((entry) => `${entry.supplierCode}${entry.listCostE6 === null ? '' : ` · ${formatUnitCost(entry.listCostE6)}`}`).join(' · ');
}

/**
 * Reads the codes of the inline form.
 *
 * @param drafts what the form holds
 * @returns the codes, or the message that says what to fix
 */
function readCodeDrafts(drafts: readonly CodeDraft[]): { ok: true; codes: SupplierCode[] } | { ok: false; message: string } {
  const codes: SupplierCode[] = [];
  for (const draft of drafts) {
    if (draft.supplierCode.trim() === '') {
      return { ok: false, message: 'Escribe el código con el que el proveedor lo vende.' };
    }
    const reading = draft.cost.trim() === '' ? null : readUnitCost(draft.cost);
    if (reading !== null && !reading.ok) {
      return { ok: false, message: reading.message };
    }
    codes.push({ supplierCode: draft.supplierCode.trim(), listCostE6: reading === null ? null : reading.unitCostE6, purchaseUnit: draft.purchaseUnit });
  }
  return { ok: true, codes };
}

/**
 * The suppliers of a product inside its panel (E1-50, ADR 0064; E1-58, ADR 0074): every supplier that sells it, with its
 * code and list cost, as many as there are. A green «Pedir más» adds the product to the draft order of that supplier, a
 * yellow «Modificar» turns the row into a form to change the supplier, its codes or its cost, a red «Eliminar» removes that
 * supplier after asking, and a short form links one more supplier.
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
  const [edit, setEdit] = useState<RowEdit | null>(null);
  const [removal, setRemoval] = useState<RowRemoval | null>(null);
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
    const reading = readCodeDrafts([{ supplierCode: code, cost, purchaseUnit: null }]);
    if (chosen === '' || code.trim() === '') {
      setMessage('Elige el proveedor y escribe el código con el que él lo vende.');
      return;
    }
    if (!reading.ok) {
      setMessage(reading.message);
      return;
    }
    run(async () => {
      const result = await api.setSupplierCodes({ supplierId: chosen, productId, codes: reading.codes, ...pinPart });
      if (result.status === 'saved' || result.status === 'unchanged') {
        setLinks(result.links);
        setInfo('Proveedor agregado al producto.');
        setCost('');
        return;
      }
      setMessage(result.status === 'authorization_required' || result.status === 'wrong_pin' || result.status === 'locked' ? ownerRefusalText(result) : 'No se pudo agregar el proveedor.');
    });
  };

  const startEdit = (row: SupplierProductLink): void => {
    setInfo(null);
    setMessage(null);
    setEdit({
      link: row,
      supplierId: row.supplierId,
      codes: row.codes.map((entry) => ({ supplierCode: entry.supplierCode, cost: entry.listCostE6 === null ? '' : unitCostText(entry.listCostE6), purchaseUnit: entry.purchaseUnit })),
    });
  };

  const changeCode = (index: number, change: Partial<CodeDraft>): void => {
    setEdit((current) => (current === null ? null : { ...current, codes: current.codes.map((entry, at) => (at === index ? { ...entry, ...change } : entry)) }));
  };

  const saveEdit = (): void => {
    if (edit === null) {
      return;
    }
    const reading = readCodeDrafts(edit.codes);
    if (!reading.ok) {
      setMessage(reading.message);
      return;
    }
    run(async () => {
      const result = await api.changeSupplierLink({ productId, fromSupplierId: edit.link.supplierId, toSupplierId: edit.supplierId, codes: reading.codes, ...pinPart });
      switch (result.status) {
        case 'saved':
        case 'unchanged':
          setLinks(result.links);
          setEdit(null);
          setInfo(result.status === 'saved' ? 'Proveedor del producto actualizado.' : 'No había nada que cambiar.');
          return;
        case 'not_linked':
          setLinks(result.links);
          setEdit(null);
          setMessage('Ese proveedor ya no tenía el producto: alguien lo cambió en otra pantalla.');
          return;
        case 'already_linked':
          setMessage(`${result.supplierName} ya vende este producto. Modifica su renglón.`);
          return;
        case 'supplier_not_found':
        case 'product_not_found':
          setMessage('No se encontró el proveedor o el producto. Revisa que sigan activos.');
          return;
        default:
          setMessage(ownerRefusalText(result));
      }
    });
  };

  const askRemoval = (row: SupplierProductLink): void => {
    setInfo(null);
    run(async () => {
      const drafts = await api.findDraftsWithProduct({ supplierId: row.supplierId, productId });
      setRemoval({ link: row, drafts, removeFromDrafts: false });
    });
  };

  const confirmRemoval = (): void => {
    if (removal === null) {
      return;
    }
    const { link: row, removeFromDrafts } = removal;
    setRemoval(null);
    run(async () => {
      const result = await api.unlinkSupplier({ supplierId: row.supplierId, productId, removeFromDrafts, ...pinPart });
      if (result.status === 'removed' || result.status === 'not_linked') {
        setLinks(result.links);
        setInfo(result.status === 'removed' && result.draftsChanged > 0 ? `${row.supplierName} quitado del producto y de su borrador.` : `${row.supplierName} quitado del producto.`);
        return;
      }
      setMessage(ownerRefusalText(result));
    });
  };

  const editOptions = edit === null ? [] : [{ value: edit.link.supplierId, label: edit.link.supplierName }, ...unlinked.map((supplier) => ({ value: supplier.id, label: supplier.name }))];

  return (
    <section className="product-suppliers" aria-label="Proveedores del producto">
      <h3>Proveedores</h3>
      {links.length === 0 ? (
        <p className="dialog-hint">Ningún proveedor tiene este producto todavía. Agrega uno abajo para poder pedirlo.</p>
      ) : (
        <ul className="product-suppliers-list scroll-area" aria-label="Proveedores que lo venden">
          {links.map((row) =>
            edit?.link.supplierId === row.supplierId ? (
              <li key={row.supplierId} className="product-suppliers-edit">
                <SelectField label="Proveedor" value={edit.supplierId} onChange={(value) => setEdit({ ...edit, supplierId: value })} options={editOptions} />
                {edit.codes.map((entry, index) => (
                  <div key={index} className="product-suppliers-edit-code">
                    <Field label={`Código del proveedor ${String(index + 1)}`} value={entry.supplierCode} onChange={(value) => changeCode(index, { supplierCode: value })} maxLength={MAX_SUPPLIER_CODE_LENGTH} />
                    <Field label={`Costo de lista ${String(index + 1)} (opcional)`} value={entry.cost} onChange={(value) => changeCode(index, { cost: value })} numeric="decimal" maxLength={14} />
                  </div>
                ))}
                <div className="product-suppliers-actions">
                  <button type="button" className="button" tabIndex={-1} disabled={isBusy} onClick={() => setEdit(null)}>
                    Cancelar
                  </button>
                  <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={saveEdit}>
                    Guardar cambios
                  </button>
                </div>
              </li>
            ) : (
              <li key={row.supplierId}>
                <div>
                  <strong>{row.supplierName}</strong>
                  <small>{describeCodes(row.codes)}</small>
                </div>
                <div className="product-suppliers-actions">
                  <button type="button" className="button button-good" tabIndex={-1} disabled={isBusy || edit !== null} onClick={() => orderMore(row)}>
                    Pedir más
                  </button>
                  <button type="button" className="button button-warning" tabIndex={-1} disabled={isBusy || edit !== null} aria-label={`Modificar ${row.supplierName}`} onClick={() => startEdit(row)}>
                    Modificar
                  </button>
                  <button type="button" className="button button-danger" tabIndex={-1} disabled={isBusy || edit !== null} aria-label={`Eliminar ${row.supplierName}`} onClick={() => askRemoval(row)}>
                    Eliminar
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
      {unlinked.length > 0 && edit === null && (
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
      {removal !== null && (
        <ConfirmDialog title={`¿Quitar a ${removal.link.supplierName} de este producto?`} confirmLabel="Sí, quitar proveedor" isDangerous onConfirm={confirmRemoval} onCancel={() => setRemoval(null)}>
          <p>Se borran sus códigos y su costo de lista para este producto. Los pedidos ya enviados no cambian.</p>
          {removal.drafts.length > 0 && (
            <>
              <p className="notice notice-warn">
                Está en {removal.drafts.length === 1 ? 'el borrador' : 'los borradores'} {removal.drafts.map((draft) => formatFolio(draft.folio)).join(', ')} de {removal.link.supplierName}. Se queda ahí a menos que marques la casilla.
              </p>
              <CheckField label="Quitarlo también del borrador" checked={removal.removeFromDrafts} onChange={(checked) => setRemoval({ ...removal, removeFromDrafts: checked })} />
            </>
          )}
        </ConfirmDialog>
      )}
    </section>
  );
}
