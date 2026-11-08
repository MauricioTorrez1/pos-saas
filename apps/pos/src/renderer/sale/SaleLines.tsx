import { formatCents, formatUnitPriceE4 } from '@pos-saas/money';
import { memo, useEffect, useRef, type ReactElement } from 'react';

import { formatQuantity } from './format';
import type { SaleLine } from './sale-state';

interface SaleLineRowProps {
  readonly line: SaleLine;
  readonly isSelected: boolean;
  readonly onSelect: (productId: string) => void;
}

/** Memoized because the lines that did not change keep their identity: adding a product redraws one row, not all. */
const SaleLineRow = memo(function SaleLineRow({ line, isSelected, onSelect }: SaleLineRowProps): ReactElement {
  const rowRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    if (isSelected) {
      rowRef.current?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [isSelected]);

  return (
    <tr ref={rowRef} aria-current={isSelected ? 'true' : undefined} onClick={() => onSelect(line.product.id)}>
      <td className="line-name">{line.product.name}</td>
      <td className="line-number">{formatQuantity(line.quantity)}</td>
      <td className="line-number">{formatUnitPriceE4(line.product.unitPriceE4)}</td>
      <td className="line-number line-amount">{formatCents(line.totals.totalCents)}</td>
    </tr>
  );
});

interface SaleLinesProps {
  readonly lines: readonly SaleLine[];
  readonly selectedProductId: string | null;
  readonly onSelect: (productId: string) => void;
}

/**
 * The products of the sale.
 *
 * @param props.lines the lines, in the order they were added
 * @param props.selectedProductId the line that the keys act on
 * @param props.onSelect called when a line is clicked
 * @returns the table, or an invitation to start when the sale is empty
 */
export function SaleLines({ lines, selectedProductId, onSelect }: SaleLinesProps): ReactElement {
  if (lines.length === 0) {
    return (
      <div className="sale-empty">
        <p className="sale-empty-title">Aún no hay productos en esta venta</p>
        <p>Escanea un código de barras o escribe el nombre para empezar.</p>
      </div>
    );
  }
  return (
    <div className="sale-lines">
      <table>
        <thead>
          <tr>
            <th scope="col">Producto</th>
            <th scope="col" className="line-number">
              Cantidad
            </th>
            <th scope="col" className="line-number">
              Precio
            </th>
            <th scope="col" className="line-number">
              Importe
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <SaleLineRow key={line.product.id} line={line} isSelected={line.product.id === selectedProductId} onSelect={onSelect} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
