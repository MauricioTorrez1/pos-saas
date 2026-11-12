import type { ReactElement } from 'react';

import type { DashboardSummary, PeriodTotals } from '../../shared/dashboard-api';
import {
  PAYMENT_KIND_LABELS,
  WEEKDAY_LABELS,
  changeLabel,
  hundredthsLabel,
  percentLabel,
  pesosLabel,
  trendLabel,
} from '../../shared/dashboard-format';
import { BarChart, type Bar } from './BarChart';

interface KpiProps {
  readonly label: string;
  readonly value: string;
  /** Smaller lines under the value, such as the part before VAT. */
  readonly detail?: string;
  /** This period and the one before, as numbers to compare. Without them, no comparison is shown. */
  readonly compare?: { readonly current: number; readonly previous: number; readonly previousLabel: string } | undefined;
}

function Kpi({ label, value, detail, compare }: KpiProps): ReactElement {
  return (
    <div className="kpi">
      <dt>{label}</dt>
      <dd>
        <span className="kpi-value">{value}</span>
        {detail !== undefined && <span className="kpi-detail">{detail}</span>}
        {/* Against a period with nothing there is no change to speak of: "new" next to every number would only be noise. */}
        {compare !== undefined && compare.previous !== 0 && (
          <span className="kpi-compare">
            {changeLabel(compare.current, compare.previous)} · antes {compare.previousLabel}
          </span>
        )}
      </dd>
    </div>
  );
}

const compareOf = (
  previous: PeriodTotals | null,
  current: number | null,
  before: number | null,
  label: (value: number) => string,
): KpiProps['compare'] => (previous === null || current === null || before === null ? undefined : { current, previous: before, previousLabel: label(before) });

/** The indicators, the charts and the ways of payment of the period. */
export function SummaryTab({ summary }: { readonly summary: DashboardSummary }): ReactElement {
  const { totals, previousTotals: before, includesCosts } = summary;
  const money = (value: number): string => pesosLabel(value);
  const hourBars: Bar[] = summary.byHour.map((row) => ({
    key: String(row.hour),
    label: `${String(row.hour).padStart(2, '0')}h`,
    value: row.totalCents,
    valueLabel: pesosLabel(row.totalCents),
    extra: String(row.salesCount),
  }));
  const weekdayBars: Bar[] = summary.byWeekday.map((row) => ({
    key: String(row.weekday),
    label: (WEEKDAY_LABELS[row.weekday] ?? '').slice(0, 3),
    value: row.totalCents,
    valueLabel: pesosLabel(row.totalCents),
    extra: String(row.salesCount),
  }));
  const trendBars: Bar[] = summary.trend.map((row) => ({
    key: row.key,
    label: trendLabel(row.key),
    value: row.totalCents,
    valueLabel: pesosLabel(row.totalCents),
    extra: String(row.salesCount),
  }));

  return (
    <>
      {summary.isInProgress && summary.previousPeriod !== null && (
        <p className="notice notice-info" role="note">
          El periodo todavía no termina, así que compararlo con uno completo hace ver menos ventas de las que hay.
        </p>
      )}
      <dl className="kpi-grid" aria-label="Indicadores del periodo">
        <Kpi
          label="Ventas totales (con IVA)"
          value={money(totals.totalCents)}
          detail={`Sin IVA ${money(totals.subtotalCents)} · IVA ${money(totals.taxCents)}`}
          compare={compareOf(before, totals.totalCents, before?.totalCents ?? null, money)}
        />
        <Kpi label="Tickets" value={String(totals.salesCount)} compare={compareOf(before, totals.salesCount, before?.salesCount ?? null, String)} />
        <Kpi
          label="Venta promedio por ticket"
          value={money(totals.averageTicketCents)}
          compare={compareOf(before, totals.averageTicketCents, before?.averageTicketCents ?? null, money)}
        />
        <Kpi
          label="Artículos por ticket"
          value={hundredthsLabel(totals.linesPerTicketX100)}
          detail="Partidas (renglones) de cada ticket"
          compare={compareOf(before, totals.linesPerTicketX100, before?.linesPerTicketX100 ?? null, hundredthsLabel)}
        />
        <Kpi
          label="Devoluciones"
          value={money(totals.returnsCents)}
          detail={`${totals.returnsCount} devolución(es)`}
          compare={compareOf(before, totals.returnsCents, before?.returnsCents ?? null, money)}
        />
        <Kpi
          label="Venta neta (con IVA)"
          value={money(totals.netCents)}
          detail={`Sin IVA ${money(totals.netSubtotalCents)}`}
          compare={compareOf(before, totals.netCents, before?.netCents ?? null, money)}
        />
        {includesCosts && (
          <>
            <Kpi
              label="Costo de lo vendido"
              value={money(totals.costOfGoodsCents ?? 0)}
              compare={compareOf(before, totals.costOfGoodsCents, before?.costOfGoodsCents ?? null, money)}
            />
            <Kpi
              label="Utilidad bruta"
              value={money(totals.grossProfitCents ?? 0)}
              detail="Venta neta sin IVA menos costo"
              compare={compareOf(before, totals.grossProfitCents, before?.grossProfitCents ?? null, money)}
            />
            <Kpi
              label="Margen"
              value={totals.marginBp === null ? 'Sin datos' : percentLabel(totals.marginBp)}
              compare={compareOf(before, totals.marginBp, before?.marginBp ?? null, percentLabel)}
            />
          </>
        )}
        <Kpi label="Cancelaciones" value={String(summary.cancellations.count)} detail={money(summary.cancellations.totalCents)} />
        <Kpi label="Descuentos" value="No aplica" detail="La caja todavía no maneja descuentos" />
        {summary.inventory !== null && <Kpi label="Inventario a costo" value={money(summary.inventory.valueCents)} />}
      </dl>
      {includesCosts && totals.productsWithoutCostSold > 0 && (
        <p className="notice" role="note">
          {totals.productsWithoutCostSold} producto(s) que se vendieron no tienen costo y no cuentan en la utilidad ni en el margen. Se marcan como «sin costo»
          en Más vendidos.
        </p>
      )}
      <BarChart
        title={summary.trendUnit === 'day' ? 'Ventas por día' : 'Ventas por mes'}
        bars={trendBars}
        columns={[summary.trendUnit === 'day' ? 'Día' : 'Mes', 'Total (con IVA)', 'Ventas']}
      />
      <BarChart title="Ventas por hora del día" bars={hourBars} columns={['Hora', 'Total (con IVA)', 'Ventas']} />
      <BarChart title="Ventas por día de la semana" bars={weekdayBars} columns={['Día', 'Total (con IVA)', 'Ventas']} />
      <table className="dashboard-table" aria-label="Ventas por forma de pago">
        <caption>Ventas por forma de pago</caption>
        <thead>
          <tr>
            <th scope="col">Forma de pago</th>
            <th scope="col">Ventas</th>
            <th scope="col">Total (con IVA)</th>
          </tr>
        </thead>
        <tbody>
          {summary.paymentKinds.map((row) => (
            <tr key={row.kind}>
              <th scope="row">{PAYMENT_KIND_LABELS[row.kind]}</th>
              <td>{row.salesCount}</td>
              <td>{money(row.totalCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <table className="dashboard-table" aria-label="Dinero recibido por medio de pago">
        <caption>Dinero recibido por medio (incluye las ventas mixtas)</caption>
        <thead>
          <tr>
            <th scope="col">Medio</th>
            <th scope="col">Monto</th>
          </tr>
        </thead>
        <tbody>
          {summary.methodAmounts.map((row) => (
            <tr key={row.method}>
              <th scope="row">{PAYMENT_KIND_LABELS[row.method]}</th>
              <td>{money(row.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {summary.byCashier !== null && (
        <table className="dashboard-table" aria-label="Ventas por cajero">
          <caption>Ventas por cajero</caption>
          <thead>
            <tr>
              <th scope="col">Cajero</th>
              <th scope="col">Ventas</th>
              <th scope="col">Total (con IVA)</th>
            </tr>
          </thead>
          <tbody>
            {summary.byCashier.map((row) => (
              <tr key={row.name}>
                <th scope="row">{row.name}</th>
                <td>{row.salesCount}</td>
                <td>{money(row.totalCents)}</td>
              </tr>
            ))}
            {summary.byCashier.length === 0 && (
              <tr>
                <td colSpan={3}>Sin ventas en este periodo.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </>
  );
}
