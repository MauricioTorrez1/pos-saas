import { formatCents, parseQuantity, type Unit } from '@pos-saas/money';
import { useState, type ReactElement } from 'react';

import { formatUnitCost } from '../../shared/product-admin';
import {
  MAX_CART_LINES,
  milliText,
  percentText,
  type CartLineRequest,
  type ComparisonGroup,
  type ComparisonOption,
  type ConfirmCartResult,
  type ExportCartResult,
  type SupplierCatalogApi,
} from '../../shared/supplier-catalog';
import { formatFolio, orderLineCents, MAX_ORDER_QUANTITY_MILLI } from '../../shared/supplier-order';
import { Field, Message, useAction } from '../ui/form-parts';
import { useWindowKeys } from '../ui/use-window-keys';
import { describeRefusal, isOwnerRefusal } from './order-form';

/** A line of the cart as the screen keeps it. */
interface CartLine {
  readonly productId: string;
  readonly productName: string;
  readonly unit: Unit;
  readonly quantityText: string;
  readonly itemId: string;
  readonly options: readonly ComparisonOption[];
}

interface PriceComparatorProps {
  readonly catalogApi: SupplierCatalogApi;
  readonly onBack: () => void;
}

/**
 * Reads the quantity typed in a line.
 *
 * @param line the line
 * @returns the quantity in thousandths, or null when it is not a valid quantity of its unit
 */
function quantityOfLine(line: CartLine): number | null {
  try {
    const milli = parseQuantity(line.quantityText.trim(), line.unit).milli;
    return milli > 0 && milli <= MAX_ORDER_QUANTITY_MILLI ? milli : null;
  } catch {
    return null;
  }
}

function chosenOf(line: CartLine): ComparisonOption | undefined {
  return line.options.find((option) => option.item.id === line.itemId);
}

function differenceText(option: ComparisonOption): string {
  if (option.differenceE6 === 0) {
    return option.isCheapest ? 'El más barato' : '—';
  }
  return `+${formatUnitCost(option.differenceE6)}${option.differenceBp === null ? '' : ` (+${percentText(option.differenceBp)})`}`;
}

function titleOf(group: ComparisonGroup): string {
  return group.productName ?? group.equivalenceName ?? 'Sin ligar a un producto';
}

function priceClass(option: ComparisonOption): string {
  return option.isCheapest ? 'price-cheapest' : option.isMostExpensive ? 'price-highest' : '';
}

function describeProblem(result: Exclude<ConfirmCartResult | ExportCartResult, { status: 'created' | 'partial' | 'saved' | 'cancelled' | 'failed' }>): string {
  if (isOwnerRefusal(result)) {
    return describeRefusal(result);
  }
  switch (result.status) {
    case 'empty':
      return 'Agrega al menos un producto.';
    case 'item_not_found':
      return 'Una lista cambió mientras armabas el carrito. Vuelve a buscar ese producto.';
    case 'item_mismatch':
      return 'Un artículo ya no está ligado a su producto. Vuelve a buscarlo.';
    case 'bad_quantity':
      return 'Revisa las cantidades: más de cero, con hasta 3 decimales, y las piezas enteras.';
  }
}

/**
 * The price comparator (E1-52): typing words lists what every supplier asks for the matching products, per base unit, with
 * the cheapest in green and the most expensive in red. "Agregar" puts a product in the cart with its cheapest supplier, and
 * the owner can switch it per line. Confirming makes one draft order per supplier; the PDF shows what was chosen against
 * the cheapest and two charts. Only the owner opens it.
 *
 * @param props.catalogApi bridge of the price lists
 * @param props.onBack called to go back to the suppliers
 * @returns the screen, to put inside a dialog
 */
export function PriceComparator({ catalogApi, onBack }: PriceComparatorProps): ReactElement {
  const [text, setText] = useState('');
  const [groups, setGroups] = useState<readonly ComparisonGroup[] | null>(null);
  const [cart, setCart] = useState<readonly CartLine[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const { isBusy, message, setMessage, run } = useAction();

  const search = (): void => {
    if (text.trim() === '') {
      return;
    }
    run(async () => setGroups(await catalogApi.compareItems(text)));
  };

  const add = (group: ComparisonGroup): void => {
    // Only the items tied to the product can be ordered; an equivalent item of another supplier is compared but not ordered.
    const orderable = group.options.filter((option) => option.item.productId === group.productId);
    const cheapest = orderable[0];
    if (group.productId === null || group.productName === null || group.productUnit === null || cheapest === undefined) {
      return;
    }
    if (cart.some((line) => line.productId === group.productId)) {
      setMessage(`${group.productName} ya está en el carrito.`);
      return;
    }
    if (cart.length >= MAX_CART_LINES) {
      setMessage(`El carrito admite hasta ${MAX_CART_LINES} productos.`);
      return;
    }
    setMessage(null);
    setNote(null);
    setCart((previous) => [...previous, { productId: group.productId!, productName: group.productName!, unit: group.productUnit!, quantityText: '1', itemId: cheapest.item.id, options: orderable }]);
  };

  const change = (productId: string, patch: Partial<CartLine>): void =>
    setCart((previous) => previous.map((line) => (line.productId === productId ? { ...line, ...patch } : line)));

  const requestLines = (): CartLineRequest[] | null => {
    const lines: CartLineRequest[] = [];
    for (const line of cart) {
      const quantityMilli = quantityOfLine(line);
      if (quantityMilli === null) {
        setMessage(`Revisa la cantidad de ${line.productName}: más de cero, con hasta 3 decimales, y las piezas enteras.`);
        return null;
      }
      lines.push({ productId: line.productId, quantityMilli, itemId: line.itemId });
    }
    return lines;
  };

  const confirm = (): void => {
    const lines = requestLines();
    if (lines === null || lines.length === 0) {
      return;
    }
    run(async () => {
      const result = await catalogApi.confirmCart({ lines });
      if (result.status === 'created' || result.status === 'partial') {
        const done = new Set(result.orders.map((order) => order.supplierName));
        setCart((previous) => previous.filter((line) => !done.has(chosenOf(line)?.item.supplierName ?? '')));
        const folios = result.orders.map((order) => `${formatFolio(order.folio)} para ${order.supplierName} (${formatCents(order.totalCents)})`).join(', ');
        setNote(result.orders.length === 0 ? null : `Listo. Quedaron como borrador: ${folios}. Los ves en «Pedido al proveedor».`);
        if (result.status === 'partial') {
          setMessage(`No se pudo guardar el pedido de ${result.failedSupplier} (revisa que siga activo); sus productos siguen en el carrito.`);
        }
      } else {
        setMessage(describeProblem(result));
      }
    });
  };

  const exportPdf = (): void => {
    const lines = requestLines();
    if (lines === null || lines.length === 0) {
      return;
    }
    run(async () => {
      const result = await catalogApi.exportCartPdf({ lines });
      if (result.status === 'saved') {
        setNote(`PDF guardado en ${result.path}.`);
      } else if (result.status === 'failed') {
        setMessage(result.message);
      } else if (result.status !== 'cancelled') {
        setMessage(describeProblem(result));
      }
    });
  };

  useWindowKeys({ F2: cart.length === 0 ? undefined : confirm, F5: cart.length === 0 ? undefined : exportPdf, Escape: onBack }, isBusy);

  let totalCents = 0;
  let cheapestCents = 0;
  for (const line of cart) {
    const quantityMilli = quantityOfLine(line);
    const chosen = chosenOf(line);
    if (quantityMilli !== null && chosen !== undefined) {
      totalCents += orderLineCents(chosen.item.baseUnitCostE6, quantityMilli);
      cheapestCents += orderLineCents(line.options[0]?.item.baseUnitCostE6 ?? chosen.item.baseUnitCostE6, quantityMilli);
    }
  }

  return (
    <>
      <h2 id="order-title">Comparar precios de proveedores</h2>
      <p>Escribe lo que buscas, como «cinta de aislar». Los precios son por unidad del producto y antes de IVA.</p>
      <Field label="Buscar en las listas" value={text} onChange={setText} autoFocus maxLength={100} onEnter={search} />
      {groups !== null && groups.length === 0 && <p>Ninguna lista tiene eso. Revisa la palabra o importa la lista del proveedor.</p>}
      {groups?.map((group) => (
        <section key={group.productId ?? group.equivalenceGroupId ?? 'unlinked'} className="comparison-group" aria-label={titleOf(group)}>
          <h3>
            {titleOf(group)}
            {group.equivalenceGroupId !== null && <small className="quantity-price"> · productos equivalentes{group.productName !== null && group.equivalenceName !== null ? ` («${group.equivalenceName}»)` : ''}</small>}
          </h3>
          <table className="order-lines" aria-label={`Precios de ${group.productName ?? group.equivalenceName ?? 'artículos sin ligar'}`}>
            <thead>
              <tr>
                <th scope="col">Proveedor</th>
                <th scope="col">Código</th>
                <th scope="col">Descripción</th>
                <th scope="col">Precio por unidad</th>
                <th scope="col">Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {group.options.map((option) => (
                <tr key={option.item.id} className={priceClass(option)}>
                  <td>{option.item.supplierName}</td>
                  <td>{option.item.supplierCode}</td>
                  <td>
                    {option.item.description}
                    {option.item.piecesFromDescription === true ? ` (${milliText(option.item.piecesPerUnitMilli)} piezas, según la descripción)` : ''}
                  </td>
                  <td className="order-amount">{formatUnitCost(option.item.baseUnitCostE6)}</td>
                  <td>{differenceText(option)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {group.productId === null ? (
            <p className="quantity-price">Para pedirlos, lígalos a un producto en la lista de precios de su proveedor.</p>
          ) : (
            <button type="button" className="button" disabled={isBusy} onClick={() => add(group)}>
              Agregar {group.productName}
            </button>
          )}
        </section>
      ))}
      {cart.length > 0 && (
        <section aria-label="Carrito">
          <h3>Carrito</h3>
          <table className="order-lines" aria-label="Productos del carrito">
            <thead>
              <tr>
                <th scope="col">Producto</th>
                <th scope="col">Cantidad</th>
                <th scope="col">Proveedor</th>
                <th scope="col">Importe</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {cart.map((line) => {
                const quantityMilli = quantityOfLine(line);
                const chosen = chosenOf(line);
                return (
                  <tr key={line.productId}>
                    <td>{line.productName}</td>
                    <td>
                      <input
                        className="cart-input"
                        aria-label={`Cantidad de ${line.productName}`}
                        inputMode="decimal"
                        maxLength={12}
                        value={line.quantityText}
                        onChange={(event) => change(line.productId, { quantityText: event.target.value })}
                      />
                    </td>
                    <td>
                      <select className="cart-input" aria-label={`Proveedor de ${line.productName}`} value={line.itemId} onChange={(event) => change(line.productId, { itemId: event.target.value })}>
                        {line.options.map((option) => (
                          <option key={option.item.id} value={option.item.id}>
                            {option.item.supplierName} · {formatUnitCost(option.item.baseUnitCostE6)}
                            {option.isCheapest ? ' (el más barato)' : ''}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="order-amount">{quantityMilli === null || chosen === undefined ? '—' : formatCents(orderLineCents(chosen.item.baseUnitCostE6, quantityMilli))}</td>
                    <td>
                      <button type="button" className="button" tabIndex={-1} onClick={() => setCart((previous) => previous.filter((other) => other.productId !== line.productId))}>
                        Quitar {line.productName}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p role="status" aria-label="Total del carrito">
            Total: {formatCents(totalCents)} · con lo más barato: {formatCents(cheapestCents)} · ahorro posible: {formatCents(totalCents - cheapestCents)}
          </p>
        </section>
      )}
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
        <button type="button" className="button" tabIndex={-1} disabled={isBusy} onClick={search}>
          Buscar <kbd>Enter</kbd>
        </button>
        <button type="button" className="button" tabIndex={-1} disabled={isBusy || cart.length === 0} onClick={exportPdf}>
          PDF del pedido <kbd>F5</kbd>
        </button>
        <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy || cart.length === 0} onClick={confirm}>
          Crear pedidos <kbd>F2</kbd>
        </button>
      </div>
    </>
  );
}
