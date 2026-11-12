import { useEffect, useState, type ReactElement } from 'react';

import { readUnitCost, unitCostText } from '../../shared/product-admin';
import { MAX_CODES_PER_SUPPLIER_PRODUCT, type OrderCandidate, type PurchasingApi, type Supplier, type SupplierCode, type SupplierProductLink } from '../../shared/supplier-order';
import { CheckField, Field, Message, useAction } from '../ui/form-parts';
import { useWindowKeys } from '../ui/use-window-keys';
import { describeRefusal, isOwnerRefusal } from './order-form';

/** What is typed in the boxes of one code. */
interface CodeBoxes {
  readonly supplierCode: string;
  readonly listCost: string;
  readonly purchaseUnit: string;
}

interface SupplierManagerProps {
  readonly api: PurchasingApi;
  /** The owner needs no PIN, and a cashier has to type the one of an owner to save. */
  readonly isOwner: boolean;
  /** Called when the suppliers changed, so the screen that opened this one reads them again. */
  readonly onChanged: () => void;
  readonly onBack: () => void;
}

type View = { readonly kind: 'suppliers' } | { readonly kind: 'codes'; readonly supplier: Supplier };

/**
 * The suppliers of the business and the codes they give to the products (E1-44): add, edit and give up a supplier (it is
 * never deleted, because the orders already sent point at it), and, for each product, one or several codes of the supplier
 * with the cost of its list and how it sells it. Saving needs the owner, or the PIN of an owner for a cashier.
 *
 * @param props.api bridge of the purchase order
 * @param props.isOwner whether the person at the register is the owner
 * @param props.onChanged called after a supplier was saved
 * @param props.onBack called to go back to the orders
 * @returns the screen, to put inside a dialog
 */
export function SupplierManager({ api, isOwner, onChanged, onBack }: SupplierManagerProps): ReactElement {
  const [view, setView] = useState<View>({ kind: 'suppliers' });
  if (view.kind === 'codes') {
    return <SupplierCodes api={api} isOwner={isOwner} supplier={view.supplier} onBack={() => setView({ kind: 'suppliers' })} />;
  }
  return <SupplierList api={api} isOwner={isOwner} onChanged={onChanged} onBack={onBack} onCodes={(supplier) => setView({ kind: 'codes', supplier })} />;
}

interface SupplierListProps extends SupplierManagerProps {
  readonly onCodes: (supplier: Supplier) => void;
}

function SupplierList({ api, isOwner, onChanged, onBack, onCodes }: SupplierListProps): ReactElement {
  const [suppliers, setSuppliers] = useState<readonly Supplier[] | null>(null);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [notes, setNotes] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [pin, setPin] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const { isBusy, message, setMessage, run } = useAction();

  const load = async (): Promise<void> => setSuppliers(await api.listSuppliers(true));

  // The list is read once, when the screen opens.
  useEffect(() => {
    run(load);
  }, []);

  const fill = (supplier: Supplier | null): void => {
    setEditing(supplier);
    setName(supplier?.name ?? '');
    setContact(supplier?.contact ?? '');
    setNotes(supplier?.notes ?? '');
    setIsActive(supplier?.isActive ?? true);
    setNote(null);
    setMessage(null);
  };

  const save = (): void => {
    if (name.trim() === '') {
      setMessage('Escribe el nombre del proveedor.');
      return;
    }
    if (!isOwner && pin === '') {
      setMessage('Pídele al dueño que escriba su PIN.');
      return;
    }
    run(async () => {
      const result = await api.saveSupplier({
        ...(editing === null ? {} : { supplierId: editing.id, expectedRevision: editing.revision }),
        name,
        contact: contact.trim() === '' ? null : contact,
        notes: notes.trim() === '' ? null : notes,
        isActive,
        ...(isOwner ? {} : { ownerPin: pin }),
      });
      if (result.status === 'saved' || result.status === 'unchanged') {
        await load();
        fill(result.supplier);
        setNote(result.status === 'saved' ? 'Listo. El proveedor quedó guardado con tu nombre.' : 'No hay cambios que guardar.');
        onChanged();
      } else if (result.status === 'duplicate_name') {
        setMessage(`Ya hay un proveedor que se llama «${result.name}».`);
      } else if (result.status === 'stale') {
        await load();
        fill(result.supplier);
        setMessage('Este proveedor cambió mientras lo editabas, así que no se guardó nada. Ya cargué cómo está ahora.');
      } else if (result.status === 'not_found') {
        setMessage('El proveedor ya no existe.');
      } else if (isOwnerRefusal(result)) {
        setPin('');
        setMessage(describeRefusal(result));
      }
    });
  };

  useWindowKeys({ F2: save, F3: () => fill(null), F4: editing === null ? undefined : () => onCodes(editing), Escape: onBack }, isBusy);

  return (
    <>
      <h2 id="order-title">Proveedores</h2>
      {suppliers !== null && suppliers.length === 0 && <p>Todavía no hay proveedores. Escribe el primero abajo.</p>}
      {suppliers !== null && suppliers.length > 0 && (
        <ul className="cash-actions" aria-label="Proveedores">
          {suppliers.map((supplier) => (
            <li key={supplier.id}>
              <button type="button" className="button" disabled={isBusy} onClick={() => fill(supplier)}>
                {supplier.name}
                {supplier.isActive ? '' : ' · dado de baja'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <h3>{editing === null ? 'Proveedor nuevo' : editing.name}</h3>
      <Field label="Nombre del proveedor" value={name} onChange={setName} autoFocus maxLength={100} />
      <Field label="Contacto (opcional)" value={contact} onChange={setContact} maxLength={200} hint="Teléfono, correo o con quién se pide." />
      <Field label="Notas (opcional)" value={notes} onChange={setNotes} maxLength={500} />
      {editing !== null && <CheckField label="Activo (quita la marca para darlo de baja)" checked={isActive} onChange={setIsActive} />}
      {!isOwner && <Field label="PIN del dueño" value={pin} onChange={setPin} type="password" maxLength={8} />}
      {note !== null && (
        <p className="notice notice-info" role="status">
          {note}
        </p>
      )}
      <Message text={message} />
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={onBack}>
          Volver <kbd>Esc</kbd>
        </button>
        <button type="button" className="button" tabIndex={-1} disabled={isBusy} onClick={() => fill(null)}>
          Proveedor nuevo <kbd>F3</kbd>
        </button>
        {editing !== null && (
          <button type="button" className="button" tabIndex={-1} disabled={isBusy} onClick={() => onCodes(editing)}>
            Códigos de productos <kbd>F4</kbd>
          </button>
        )}
        <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={save}>
          Guardar <kbd>F2</kbd>
        </button>
      </div>
    </>
  );
}

interface SupplierCodesProps {
  readonly api: PurchasingApi;
  readonly isOwner: boolean;
  readonly supplier: Supplier;
  readonly onBack: () => void;
}

function boxesOf(codes: readonly SupplierCode[]): CodeBoxes[] {
  return codes.map(({ supplierCode, listCostE6, purchaseUnit }) => ({
    supplierCode,
    listCost: listCostE6 === null ? '' : unitCostText(listCostE6),
    purchaseUnit: purchaseUnit ?? '',
  }));
}

/** The codes one supplier gives to a product, found by name or barcode. */
function SupplierCodes({ api, isOwner, supplier, onBack }: SupplierCodesProps): ReactElement {
  const [text, setText] = useState('');
  const [choices, setChoices] = useState<readonly OrderCandidate[]>([]);
  const [product, setProduct] = useState<OrderCandidate | null>(null);
  const [links, setLinks] = useState<readonly SupplierProductLink[]>([]);
  const [rows, setRows] = useState<readonly CodeBoxes[]>([]);
  const [pin, setPin] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const { isBusy, message, setMessage, run } = useAction();

  const open = (candidate: OrderCandidate): void =>
    run(async () => {
      const found = await api.getSupplierLinks(candidate.productId);
      setProduct(candidate);
      setChoices([]);
      setLinks(found);
      setRows(boxesOf(found.find(({ supplierId }) => supplierId === supplier.id)?.codes ?? []));
      setNote(null);
    });

  const search = (): void => {
    if (text.trim() === '') {
      return;
    }
    run(async () => {
      const found = await api.searchOrderProducts({ supplierId: supplier.id, text });
      if (found.length === 0) {
        setMessage('No hay ningún producto con eso.');
      } else if (found.length === 1) {
        const links = await api.getSupplierLinks(found[0]!.productId);
        setProduct(found[0]!);
        setLinks(links);
        setRows(boxesOf(links.find(({ supplierId }) => supplierId === supplier.id)?.codes ?? []));
        setNote(null);
      } else {
        setChoices(found);
      }
    });
  };

  const change = (index: number, patch: Partial<CodeBoxes>): void => {
    setNote(null);
    setRows((previous) => previous.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  };

  const save = (): void => {
    if (product === null) {
      return;
    }
    const codes: SupplierCode[] = [];
    for (const row of rows) {
      const code = row.supplierCode.trim();
      if (code === '') {
        setMessage('Cada renglón necesita su código. Quita los que estén vacíos.');
        return;
      }
      let listCostE6: number | null = null;
      if (row.listCost.trim() !== '') {
        const cost = readUnitCost(row.listCost);
        if (!cost.ok) {
          setMessage(cost.message);
          return;
        }
        listCostE6 = cost.unitCostE6;
      }
      codes.push({ supplierCode: code, listCostE6, purchaseUnit: row.purchaseUnit.trim() === '' ? null : row.purchaseUnit.trim() });
    }
    if (new Set(codes.map(({ supplierCode }) => supplierCode.toLowerCase())).size !== codes.length) {
      setMessage('Hay un código repetido en la lista.');
      return;
    }
    if (!isOwner && pin === '') {
      setMessage('Pídele al dueño que escriba su PIN.');
      return;
    }
    run(async () => {
      const result = await api.setSupplierCodes({ supplierId: supplier.id, productId: product.productId, codes, ...(isOwner ? {} : { ownerPin: pin }) });
      if (result.status === 'saved' || result.status === 'unchanged') {
        setLinks(result.links);
        setNote(result.status === 'saved' ? 'Listo. Los códigos quedaron guardados con tu nombre.' : 'No hay cambios que guardar.');
      } else if (result.status === 'supplier_not_found' || result.status === 'product_not_found') {
        setMessage('El proveedor o el producto ya no existe.');
      } else {
        setPin('');
        setMessage(describeRefusal(result));
      }
    });
  };

  useWindowKeys({ F2: product === null ? undefined : save, Escape: product === null ? onBack : () => setProduct(null) }, isBusy);

  const others = links.filter(({ supplierId }) => supplierId !== supplier.id);
  return (
    <>
      <h2 id="order-title">Códigos de {supplier.name}</h2>
      {product === null ? (
        <>
          <p>Busca el producto por su nombre o su código de barras, y oprime Enter.</p>
          <Field label="Producto" value={text} onChange={setText} autoFocus maxLength={100} onEnter={search} />
          {choices.length > 0 && (
            <ul className="cash-actions" aria-label="Productos encontrados">
              {choices.map((choice) => (
                <li key={choice.productId}>
                  <button type="button" className="button" disabled={isBusy} onClick={() => open(choice)}>
                    {choice.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <>
          <h3>{product.name}</h3>
          <p>Código de barras propio: {product.barcode ?? 'ninguno'}. Aquí van los códigos con los que el proveedor lo conoce: puede ser uno o varios.</p>
          {rows.map((row, index) => (
            <fieldset key={index} className="order-code">
              <legend>Código {index + 1}</legend>
              <Field label={`Código o SKU del proveedor ${index + 1}`} value={row.supplierCode} onChange={(supplierCode) => change(index, { supplierCode })} maxLength={64} />
              <Field label={`Costo de lista ${index + 1} (opcional)`} value={row.listCost} onChange={(listCost) => change(index, { listCost })} maxLength={16} hint="Por unidad del producto, en pesos." />
              <Field label={`Presentación ${index + 1} (opcional)`} value={row.purchaseUnit} onChange={(purchaseUnit) => change(index, { purchaseUnit })} maxLength={60} hint="Por ejemplo: Caja con 12." />
              <button type="button" className="button" tabIndex={-1} onClick={() => setRows((previous) => previous.filter((_, position) => position !== index))}>
                Quitar código {index + 1}
              </button>
            </fieldset>
          ))}
          {rows.length < MAX_CODES_PER_SUPPLIER_PRODUCT && (
            <button type="button" className="button" tabIndex={-1} onClick={() => setRows((previous) => [...previous, { supplierCode: '', listCost: '', purchaseUnit: '' }])}>
              Agregar un código
            </button>
          )}
          {others.length > 0 && (
            <p className="quantity-price">También lo conocen: {others.map((link) => `${link.supplierName} (${link.codes.map(({ supplierCode }) => supplierCode).join(', ')})`).join('; ')}.</p>
          )}
          {!isOwner && <Field label="PIN del dueño" value={pin} onChange={setPin} type="password" maxLength={8} />}
        </>
      )}
      {note !== null && (
        <p className="notice notice-info" role="status">
          {note}
        </p>
      )}
      <Message text={message} />
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={product === null ? onBack : () => setProduct(null)}>
          {product === null ? 'Volver' : 'Otro producto'} <kbd>Esc</kbd>
        </button>
        {product !== null && (
          <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={save}>
            Guardar códigos <kbd>F2</kbd>
          </button>
        )}
      </div>
    </>
  );
}
