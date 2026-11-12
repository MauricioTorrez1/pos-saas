import type { ReactElement } from 'react';

import { TOP_LIMITS, TOP_METRICS, type DashboardSummary, type TopLimit, type TopMetric } from '../../shared/dashboard-api';
import { TOP_METRIC_LABELS, costLabel, pesosLabel, quantityText } from '../../shared/dashboard-format';

interface TopSellersTabProps {
  readonly summary: DashboardSummary;
  readonly metric: TopMetric;
  readonly limit: TopLimit;
  readonly onMetricChange: (metric: TopMetric) => void;
  readonly onLimitChange: (limit: TopLimit) => void;
}

/** «Más vendidos» of the period, in the order and the size the person chooses. */
export function TopSellersTab({ summary, metric, limit, onMetricChange, onLimitChange }: TopSellersTabProps): ReactElement {
  const { includesCosts } = summary;
  const metrics = TOP_METRICS.filter((candidate) => includesCosts || candidate !== 'profit');
  return (
    <>
      <div className="dashboard-controls">
        <div role="group" aria-label="Ordenar por" className="segmented">
          {metrics.map((candidate) => (
            <button key={candidate} type="button" className="segment" aria-pressed={candidate === metric} onClick={() => onMetricChange(candidate)}>
              {TOP_METRIC_LABELS[candidate]}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Cuántos mostrar" className="segmented">
          {TOP_LIMITS.map((candidate) => (
            <button key={candidate} type="button" className="segment" aria-pressed={candidate === limit} onClick={() => onLimitChange(candidate)}>
              Top {candidate}
            </button>
          ))}
        </div>
      </div>
      {summary.topSellers.length === 0 ? (
        <p className="sale-empty">No hubo ventas en este periodo.</p>
      ) : (
        <table className="dashboard-table" aria-label="Productos más vendidos">
          <caption>
            Más vendidos del periodo ({TOP_METRIC_LABELS[summary.topMetric].toLowerCase()}). Las devoluciones se muestran aparte y no se restan aquí.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="left">
                #
              </th>
              <th scope="col" className="left">
                Producto
              </th>
              <th scope="col">Cantidad</th>
              <th scope="col">Importe (con IVA)</th>
              {includesCosts && (
                <>
                  <th scope="col">Costo unitario</th>
                  <th scope="col">Utilidad (sin IVA)</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {summary.topSellers.map((seller) => (
              <tr key={seller.productId}>
                <td className="left">{seller.rank}</td>
                <th scope="row">{seller.name}</th>
                <td>{quantityText(seller.quantityMilli, seller.unit)}</td>
                <td>{pesosLabel(seller.amountCents)}</td>
                {includesCosts && (
                  <>
                    <td>
                      {seller.costE6 === null ? <span className="badge-warning">sin costo</span> : costLabel(seller.costE6)}
                      {seller.costSource === 'average' && <small className="cost-note"> promedio</small>}
                    </td>
                    <td>{seller.profitCents === null ? '—' : pesosLabel(seller.profitCents)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
