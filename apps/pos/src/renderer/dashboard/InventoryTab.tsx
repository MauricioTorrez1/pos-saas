import type { ReactElement } from 'react';

import type { InventorySection, LimitedList, StockLine } from '../../shared/dashboard-api';
import { pesosLabel, quantityText } from '../../shared/dashboard-format';

interface StockListProps {
  readonly title: string;
  readonly hint: string;
  readonly list: LimitedList<StockLine>;
}

function StockList({ title, hint, list }: StockListProps): ReactElement {
  return (
    <section className="dashboard-section" aria-label={title}>
      <h3>
        {title} <span className="count">({list.total})</span>
      </h3>
      <p className="hint">{hint}</p>
      {list.items.length === 0 ? (
        <p className="empty">Nada por aquí.</p>
      ) : (
        <table className="dashboard-table" aria-label={title}>
          <thead>
            <tr>
              <th scope="col">Producto</th>
              <th scope="col">Existencia</th>
              <th scope="col">Valor a costo</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((line) => (
              <tr key={line.productId}>
                <th scope="row">{line.name}</th>
                <td>{quantityText(line.stockMilli, line.unit)}</td>
                <td>{line.valueCents === null ? <span className="badge-warning">sin costo</span> : pesosLabel(line.valueCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {list.total > list.items.length && <p className="hint">Se muestran los primeros {list.items.length}.</p>}
    </section>
  );
}

/** What the stock is worth and what needs a look. Only for the owner. */
export function InventoryTab({ inventory }: { readonly inventory: InventorySection }): ReactElement {
  return (
    <>
      <dl className="kpi-grid" aria-label="Inventario">
        <div className="kpi">
          <dt>Valor del inventario a costo</dt>
          <dd>
            <span className="kpi-value">{pesosLabel(inventory.valueCents)}</span>
            {inventory.stockedWithoutCost > 0 && <span className="kpi-detail">{inventory.stockedWithoutCost} producto(s) con existencia y sin costo no están incluidos</span>}
          </dd>
        </div>
      </dl>
      <StockList title="Agotados o en negativo" hint="Productos activos con existencia en cero o menos." list={inventory.outOfStock} />
      <StockList
        title="Por agotarse"
        hint="Se vendió en el periodo tanto como la existencia que queda: a este ritmo se acaba en el siguiente."
        list={inventory.runningLow}
      />
      <StockList title="Sin movimiento" hint="Tienen existencia y no se vendieron en el periodo. Primero los que más dinero tienen detenido." list={inventory.notSelling} />
      <StockList title="Sin costo" hint="Se venden o tienen existencia y nadie ha capturado su costo. Captúralo en el panel de productos (F10)." list={inventory.withoutCost} />
    </>
  );
}
