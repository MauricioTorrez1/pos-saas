import { useState, type ReactElement } from 'react';

import type { DashboardSummary } from '../../shared/dashboard-api';
import { PAYMENT_KIND_LABELS, WEEKDAY_LABELS, pesosLabel, trendLabel } from '../../shared/dashboard-format';
import { BarChart, type Bar } from './BarChart';

type Dimension = 'trend' | 'hour' | 'weekday' | 'payment' | 'cashier';
type Metric = 'amount' | 'tickets' | 'average';

interface Row {
  readonly key: string;
  readonly label: string;
  readonly totalCents: number;
  readonly salesCount: number;
}

const METRICS: readonly { readonly id: Metric; readonly label: string; readonly column: string }[] = [
  { id: 'amount', label: 'Importe', column: 'Total (con IVA)' },
  { id: 'tickets', label: 'Número de ventas', column: 'Ventas' },
  { id: 'average', label: 'Ticket promedio', column: 'Promedio por venta' },
];

function rowsOf(summary: DashboardSummary, dimension: Dimension): Row[] {
  switch (dimension) {
    case 'trend':
      return summary.trend.map((row) => ({ key: row.key, label: trendLabel(row.key), totalCents: row.totalCents, salesCount: row.salesCount }));
    case 'hour':
      return summary.byHour.map((row) => ({ key: String(row.hour), label: `${String(row.hour).padStart(2, '0')}h`, totalCents: row.totalCents, salesCount: row.salesCount }));
    case 'weekday':
      return summary.byWeekday.map((row) => ({
        key: String(row.weekday),
        label: (WEEKDAY_LABELS[row.weekday] ?? '').slice(0, 3),
        totalCents: row.totalCents,
        salesCount: row.salesCount,
      }));
    case 'payment':
      return summary.paymentKinds.map((row) => ({ key: row.kind, label: PAYMENT_KIND_LABELS[row.kind], totalCents: row.totalCents, salesCount: row.salesCount }));
    case 'cashier':
      return (summary.byCashier ?? []).map((row) => ({ key: row.name, label: row.name, totalCents: row.totalCents, salesCount: row.salesCount }));
  }
}

function barOf(row: Row, metric: Metric): Bar {
  const average = row.salesCount === 0 ? 0 : Math.round(row.totalCents / row.salesCount);
  const value = metric === 'amount' ? row.totalCents : metric === 'tickets' ? row.salesCount : average;
  return {
    key: row.key,
    label: row.label,
    value,
    valueLabel: metric === 'tickets' ? `${String(row.salesCount)} venta${row.salesCount === 1 ? '' : 's'}` : pesosLabel(value),
    extra: metric === 'tickets' ? pesosLabel(row.totalCents) : String(row.salesCount),
  };
}

/**
 * The charts of the summary, with two filters: what the bars are split by (day, hour, weekday, payment or cashier) and
 * what they measure (money, number of sales, or the average sale). One chart at a time, large enough to read from the
 * counter, instead of a column of small ones.
 *
 * @param props.summary the summary of the period
 * @returns the filters and the chart
 */
export function SalesCharts({ summary }: { readonly summary: DashboardSummary }): ReactElement {
  const trendTitle = summary.trendUnit === 'day' ? 'Ventas por día' : 'Ventas por mes';
  const dimensions: readonly { readonly id: Dimension; readonly label: string; readonly title: string; readonly column: string }[] = [
    { id: 'trend', label: summary.trendUnit === 'day' ? 'Por día' : 'Por mes', title: trendTitle, column: summary.trendUnit === 'day' ? 'Día' : 'Mes' },
    { id: 'hour', label: 'Por hora', title: 'Ventas por hora del día', column: 'Hora' },
    { id: 'weekday', label: 'Por día de la semana', title: 'Ventas por día de la semana', column: 'Día' },
    { id: 'payment', label: 'Por forma de pago', title: 'Ventas por forma de pago', column: 'Forma de pago' },
    ...(summary.byCashier === null ? [] : [{ id: 'cashier' as const, label: 'Por cajero', title: 'Ventas por cajero', column: 'Cajero' }]),
  ];
  // A single day has one bar by day, which says nothing, so a day opens split by hour.
  const [dimension, setDimension] = useState<Dimension>(summary.trend.length > 1 ? 'trend' : 'hour');
  const [metric, setMetric] = useState<Metric>('amount');
  const shown = dimensions.find((candidate) => candidate.id === dimension) ?? dimensions[0]!;
  const measured = METRICS.find((candidate) => candidate.id === metric)!;
  const bars = rowsOf(summary, shown.id).map((row) => barOf(row, metric));

  return (
    <section className="charts" aria-label="Gráficas de ventas">
      <div className="charts-filters">
        <div className="filter-group" role="group" aria-label="Ver las ventas">
          <span className="filter-label">Ver</span>
          <div className="segmented">
            {dimensions.map(({ id, label }) => (
              <button key={id} type="button" className="segment" aria-pressed={shown.id === id} onClick={() => setDimension(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-group" role="group" aria-label="Medir">
          <span className="filter-label">Medir</span>
          <div className="segmented">
            {METRICS.map(({ id, label }) => (
              <button key={id} type="button" className="segment" aria-pressed={metric === id} onClick={() => setMetric(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <BarChart
        title={shown.title}
        bars={bars}
        columns={[shown.column, measured.column, metric === 'tickets' ? 'Total (con IVA)' : 'Ventas']}
        emptyText={metric === 'tickets' ? 'Sin ventas en este periodo.' : undefined}
      />
    </section>
  );
}
