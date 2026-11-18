import { useEffect, useState, type ReactElement } from 'react';

import { formatUnitCost } from '../../shared/product-admin';
import {
  PRICE_LIST_FIELDS,
  PRICE_LIST_FIELD_LABELS,
  type CatalogItem,
  type ColumnMapping,
  type ImportPriceListResult,
  type PriceListField,
  type PriceListPreview,
  type PriceListSource,
  type PriceListSummary,
  type SupplierCatalogApi,
} from '../../shared/supplier-catalog';
import type { OrderCandidate, PurchasingApi, Supplier } from '../../shared/supplier-order';
import { CheckField, Field, Message, SelectField, useAction } from '../ui/form-parts';
import { useWindowKeys } from '../ui/use-window-keys';

interface PriceListScreenProps {
  readonly api: PurchasingApi;
  readonly catalogApi: SupplierCatalogApi;
  readonly supplier: Supplier;
  readonly onBack: () => void;
}

const LINK_LABELS = { supplier_code: 'por su código', barcode: 'por código de barras', manual: 'a mano' } as const;

/**
 * Writes a quantity in thousandths without decimal numbers: 12000 is "12" and 2500 is "2.5".
 *
 * @param milli the quantity in thousandths
 * @returns the text
 */
export function milliText(milli: number): string {
  const fraction = String(milli % 1000).padStart(3, '0').replace(/0+$/u, '');
  return `${Math.floor(milli / 1000)}${fraction === '' ? '' : `.${fraction}`}`;
}

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function describeImport(result: ImportPriceListResult): string {
  switch (result.status) {
    case 'imported':
      return `Listo. Entraron ${result.summary.itemCount} artículos y ${result.summary.linkedCount} quedaron ligados a tus productos.${result.summary.skippedCount > 0 ? ` ${result.summary.skippedCount} renglones no entraron (abajo dice por qué).` : ''}`;
    case 'expired':
      return 'El archivo ya no está en memoria. Elígelo de nuevo.';
    case 'supplier_not_found':
      return 'El proveedor ya no existe.';
    case 'missing_columns':
      return `Falta elegir la columna de: ${result.fields.map((field) => PRICE_LIST_FIELD_LABELS[field]).join(', ')}.`;
    case 'empty':
      return 'Ningún renglón se pudo leer, así que se quedó la lista anterior.';
  }
}

/**
 * The price list of one supplier (E1-51): import it from Excel or CSV choosing the columns once (they are remembered), say
 * whether the costs include VAT, and tie the items to the products of the store. Only the owner opens it.
 *
 * @param props.api bridge of the purchase order, to find products
 * @param props.catalogApi bridge of the price lists
 * @param props.supplier the supplier whose list this is
 * @param props.onBack called to go back to the suppliers
 * @returns the screen, to put inside a dialog
 */
export function PriceListScreen({ api, catalogApi, supplier, onBack }: PriceListScreenProps): ReactElement {
  const [summary, setSummary] = useState<PriceListSummary | null>(null);
  const [preview, setPreview] = useState<PriceListPreview | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [includesVat, setIncludesVat] = useState(false);
  const [source, setSource] = useState<PriceListSource>('file');
  const [listDate, setListDate] = useState(today());
  const [skipped, setSkipped] = useState<readonly { rowNumber: number; reason: string }[]>([]);
  const [items, setItems] = useState<readonly CatalogItem[]>([]);
  const [onlyUnlinked, setOnlyUnlinked] = useState(true);
  const [text, setText] = useState('');
  const [linking, setLinking] = useState<CatalogItem | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { isBusy, message, setMessage, run } = useAction();

  const load = async (unlinked = onlyUnlinked, words = text): Promise<void> => {
    const [loadedSummary, loadedItems] = await Promise.all([
      catalogApi.priceListSummary(supplier.id),
      catalogApi.listCatalogItems({ supplierId: supplier.id, onlyUnlinked: unlinked, text: words }),
    ]);
    setSummary(loadedSummary);
    setItems(loadedItems);
  };

  // The list is read once, when the screen opens.
  useEffect(() => {
    run(() => load());
  }, []);

  const pick = (): void =>
    run(async () => {
      const result = await catalogApi.pickPriceList(supplier.id);
      if (result.status === 'unreadable') {
        setMessage(result.message);
      } else if (result.status === 'picked') {
        setPreview(result.preview);
        setMapping(result.preview.mapping);
        setIncludesVat(result.preview.costsIncludeVat);
        setSource(result.preview.source);
        setSkipped([]);
        setNote(
          result.preview.mappingOrigin === 'remembered'
            ? 'Usé las mismas columnas que la última lista de este proveedor.'
            : result.preview.mappingOrigin === 'agreed'
              ? 'Es el archivo del catálogo en papel: ya reconocí sus columnas.'
              : 'Revisa que cada dato apunte a la columna correcta.',
        );
      }
    });

  const confirmImport = (): void => {
    if (preview === null) {
      return;
    }
    run(async () => {
      const result = await catalogApi.importPriceList({ token: preview.token, supplierId: supplier.id, mapping, costsIncludeVat: includesVat, listDate, source });
      setNote(null);
      if (result.status === 'imported') {
        setNote(describeImport(result));
        setSkipped(result.summary.skipped);
        setPreview(null);
        await load();
      } else {
        setMessage(describeImport(result));
        setSkipped(result.status === 'empty' ? result.skipped : []);
        if (result.status === 'expired') {
          setPreview(null);
        }
      }
    });
  };

  const changeFilter = (unlinked: boolean, words: string): void => {
    setOnlyUnlinked(unlinked);
    setText(words);
    run(() => load(unlinked, words));
  };

  useWindowKeys(
    linking !== null ? {} : { F2: preview === null ? pick : confirmImport, Escape: preview === null ? onBack : () => setPreview(null) },
    isBusy,
  );

  if (linking !== null) {
    return (
      <LinkItem
        api={api}
        catalogApi={catalogApi}
        item={linking}
        onDone={(done) => {
          setLinking(null);
          setNote(done);
          run(() => load());
        }}
      />
    );
  }

  const columnOptions = [{ value: '', label: '— no viene —' }, ...(preview?.headers ?? []).filter((header) => header !== '').map((header) => ({ value: header, label: header }))];
  return (
    <>
      <h2 id="order-title">Lista de precios de {supplier.name}</h2>
      {summary !== null && (
        <p>
          {summary.listDate === null
            ? 'Este proveedor todavía no tiene lista. Elige su archivo de Excel o CSV.'
            : `Lista del ${summary.listDate} (${summary.source === 'paper' ? 'catálogo en papel' : 'archivo'}): ${summary.itemCount} artículos, ${summary.linkedCount} ligados a tus productos. Importar otra la reemplaza completa.`}
        </p>
      )}
      {preview !== null && (
        <section aria-label="Columnas del archivo">
          <h3>{preview.fileName}</h3>
          <p>{preview.rowCount} renglones. Dime en qué columna viene cada dato:</p>
          {PRICE_LIST_FIELDS.map((field: PriceListField) => (
            <SelectField
              key={field}
              label={PRICE_LIST_FIELD_LABELS[field]}
              value={mapping[field] ?? ''}
              options={columnOptions}
              onChange={(header) => setMapping((previous) => ({ ...previous, [field]: header === '' ? undefined : header }))}
            />
          ))}
          <SelectField
            label="¿Los costos del archivo incluyen IVA?"
            value={includesVat ? 'yes' : 'no'}
            options={[
              { value: 'no', label: 'No, son antes de IVA' },
              { value: 'yes', label: 'Sí, ya traen el IVA (le quito el 16 %)' },
            ]}
            onChange={(answer) => setIncludesVat(answer === 'yes')}
          />
          <SelectField
            label="¿De dónde viene la lista?"
            value={source}
            options={[
              { value: 'file', label: 'Archivo del proveedor' },
              { value: 'paper', label: 'Catálogo en papel leído con la cámara' },
            ]}
            onChange={setSource}
          />
          <Field label="Fecha de la lista (AAAA-MM-DD)" value={listDate} onChange={setListDate} maxLength={10} />
          <table className="order-lines" aria-label="Primeros renglones">
            <thead>
              <tr>
                {preview.headers.map((header, index) => (
                  <th key={index} scope="col">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.sampleRows.map((row, index) => (
                <tr key={index}>
                  {preview.headers.map((_, column) => (
                    <td key={column}>{row[column] ?? ''}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {note !== null && (
        <p className="notice notice-info" role="status">
          {note}
        </p>
      )}
      <Message text={message} />
      {skipped.length > 0 && (
        <ul aria-label="Renglones que no entraron">
          {skipped.map((row) => (
            <li key={row.rowNumber}>
              Renglón {row.rowNumber}: {row.reason}
            </li>
          ))}
        </ul>
      )}
      {preview === null && summary !== null && summary.itemCount > 0 && (
        <section aria-label="Artículos de la lista">
          <CheckField label="Solo los que no están ligados a un producto" checked={onlyUnlinked} onChange={(checked) => changeFilter(checked, text)} />
          <Field label="Buscar en la lista" value={text} onChange={setText} maxLength={100} onEnter={() => changeFilter(onlyUnlinked, text)} />
          {items.length === 0 ? (
            <p>{onlyUnlinked ? 'Todos los artículos están ligados.' : 'No hay artículos con eso.'}</p>
          ) : (
            <table className="order-lines" aria-label="Artículos">
              <thead>
                <tr>
                  <th scope="col">Código</th>
                  <th scope="col">Descripción</th>
                  <th scope="col">Presentación</th>
                  <th scope="col">Costo</th>
                  <th scope="col">Por unidad</th>
                  <th scope="col">Tu producto</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.supplierCode}</td>
                    <td>{item.description}</td>
                    <td>
                      {item.purchaseUnit ?? '—'} · {milliText(item.piecesPerUnitMilli)} pzas
                    </td>
                    <td className="order-amount">{formatUnitCost(item.listCostE6)}</td>
                    <td className="order-amount">{formatUnitCost(item.baseUnitCostE6)}</td>
                    <td>
                      {item.productName === null ? 'Sin ligar' : `${item.productName} (${item.linkOrigin === null ? '' : LINK_LABELS[item.linkOrigin]})`}{' '}
                      <button type="button" className="button" disabled={isBusy} onClick={() => setLinking(item)}>
                        {item.productId === null ? 'Ligar' : 'Cambiar'} {item.supplierCode}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={preview === null ? onBack : () => setPreview(null)}>
          {preview === null ? 'Volver' : 'Cancelar'} <kbd>Esc</kbd>
        </button>
        {preview === null ? (
          <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={pick}>
            Importar lista <kbd>F2</kbd>
          </button>
        ) : (
          <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={confirmImport}>
            Reemplazar la lista <kbd>F2</kbd>
          </button>
        )}
      </div>
    </>
  );
}

interface LinkItemProps {
  readonly api: PurchasingApi;
  readonly catalogApi: SupplierCatalogApi;
  readonly item: CatalogItem;
  readonly onDone: (note: string | null) => void;
}

/** Ties one item of the list to a product of the store, found by name or barcode, once: the next list remembers it. */
function LinkItem({ api, catalogApi, item, onDone }: LinkItemProps): ReactElement {
  const [text, setText] = useState(item.description);
  const [choices, setChoices] = useState<readonly OrderCandidate[]>([]);
  const { isBusy, message, setMessage, run } = useAction();

  const search = (): void =>
    run(async () => {
      const found = await api.searchOrderProducts({ supplierId: null, text });
      setChoices(found);
      setMessage(found.length === 0 ? 'No hay ningún producto con eso. Prueba con menos palabras.' : null);
    });

  const link = (productId: string | null): void =>
    run(async () => {
      const result = await catalogApi.linkCatalogItem({ itemId: item.id, productId });
      if (result.status === 'linked') {
        onDone(productId === null ? `${item.supplierCode} quedó sin ligar.` : `Listo. ${item.supplierCode} quedó ligado a ${result.item.productName ?? ''}; la próxima lista lo recordará.`);
      } else {
        setMessage(result.status === 'not_found' ? 'El artículo ya no está en la lista.' : 'El producto ya no existe.');
      }
    });

  useWindowKeys({ Escape: () => onDone(null) }, isBusy);

  return (
    <>
      <h2 id="order-title">Ligar {item.supplierCode}</h2>
      <p>
        {item.description} · {formatUnitCost(item.baseUnitCostE6)} por unidad. ¿Cuál de tus productos es?
      </p>
      <Field label="Producto" value={text} onChange={setText} autoFocus maxLength={100} onEnter={search} />
      {choices.length > 0 && (
        <ul className="cash-actions" aria-label="Productos encontrados">
          {choices.map((choice) => (
            <li key={choice.productId}>
              <button type="button" className="button" disabled={isBusy} onClick={() => link(choice.productId)}>
                {choice.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Message text={message} />
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={() => onDone(null)}>
          Volver <kbd>Esc</kbd>
        </button>
        {item.productId !== null && (
          <button type="button" className="button" tabIndex={-1} disabled={isBusy} onClick={() => link(null)}>
            Quitar el ligado
          </button>
        )}
        <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={search}>
          Buscar <kbd>Enter</kbd>
        </button>
      </div>
    </>
  );
}
