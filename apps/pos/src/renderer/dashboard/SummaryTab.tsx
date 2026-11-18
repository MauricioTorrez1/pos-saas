import type { ReactElement, ReactNode } from 'react';

import type { DashboardSummary, PeriodTotals } from '../../shared/dashboard-api';
import {
  PAYMENT_KIND_LABELS,
  changeLabel,
  hundredthsLabel,
  percentLabel,
  pesosLabel,
} from '../../shared/dashboard-format';
import { SalesCharts } from './SalesCharts';

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

interface GroupProps {
  readonly id: string;
  readonly title: string;
  /** One sentence under the title that says what the numbers of the group answer. */
  readonly lead: string;
  readonly children: ReactNode;
}

/** A labeled group of related numbers, so what is read together sits together (E1-56). */
function Group({ id, title, lead, children }: GroupProps): ReactElement {
  return (
    <section className="kpi-group" aria-labelledby={`${id}-title`}>
      <header className="kpi-group-header">
        <h3 id={`${id}-title`}>{title}</h3>
        <p>{lead}</p>
      </header>
      {children}
    </section>
  );
}

function PaymentTables({ summary }: { readonly summary: DashboardSummary }): ReactElement {
  return (
    <>
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
              <td>{pesosLabel(row.totalCents)}</td>
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
              <td>{pesosLabel(row.amountCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function DrawerGroup({ summary }: { readonly summary: DashboardSummary }): ReactElement {
  const { cashMovements, byCashier } = summary;
  return (
    <Group id="group-drawer" title="Caja" lead="El efectivo que entró y salió a mano, y lo que vendió cada cajero.">
      {cashMovements !== null && (
        <dl className="kpi-grid" aria-label="Movimientos de la caja">
          <Kpi label="Entradas de efectivo" value={pesosLabel(cashMovements.inCents)} detail="Dinero que se metió a la caja" />
          <Kpi
            label="Salidas de efectivo"
            value={pesosLabel(cashMovements.outCents)}
            detail={`Retiros y pagos · de ellos, gastos ${pesosLabel(cashMovements.drawerExpensesCents)}`}
          />
        </dl>
      )}
      {byCashier !== null && (
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
            {byCashier.map((row) => (
              <tr key={row.name}>
                <th scope="row">{row.name}</th>
                <td>{row.salesCount}</td>
                <td>{pesosLabel(row.totalCents)}</td>
              </tr>
            ))}
            {byCashier.length === 0 && (
              <tr>
                <td colSpan={3}>Sin ventas en este periodo.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </Group>
  );
}

/**
 * The indicators of the period in labeled groups (sales, tickets, profitability, returns), then the ways of payment, the
 * drawer and the charts. Every number keeps its comparison with the period before (E1-45, E1-56).
 *
 * @param props.summary what the dashboard read
 * @returns the tab
 */
export function SummaryTab({ summary }: { readonly summary: DashboardSummary }): ReactElement {
  const { totals, previousTotals: before, includesCosts } = summary;
  const money = (value: number): string => pesosLabel(value);
  return (
    <>
      {summary.isInProgress && summary.previousPeriod !== null && (
        <p className="notice notice-info" role="note">
          El periodo todavía no termina, así que compararlo con uno completo hace ver menos ventas de las que hay.
        </p>
      )}
      <div className="kpi-groups" aria-label="Indicadores del periodo">
        <Group id="group-sales" title="Ventas" lead="Cuánto vendiste y cuánto te quedó después de las devoluciones.">
          <dl className="kpi-grid">
            <Kpi
              label="Ventas totales (con IVA)"
              value={money(totals.totalCents)}
              detail={`Sin IVA ${money(totals.subtotalCents)} · IVA ${money(totals.taxCents)}`}
              compare={compareOf(before, totals.totalCents, before?.totalCents ?? null, money)}
            />
            <Kpi
              label="Venta neta (con IVA)"
              value={money(totals.netCents)}
              detail={`Sin IVA ${money(totals.netSubtotalCents)}`}
              compare={compareOf(before, totals.netCents, before?.netCents ?? null, money)}
            />
          </dl>
        </Group>
        <Group id="group-tickets" title="Clientes y tickets" lead="Cuántas veces cobraste y cuánto se lleva cada cliente.">
          <dl className="kpi-grid">
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
          </dl>
        </Group>
        {includesCosts && (
          <Group id="group-profit" title="Rentabilidad" lead="Lo que te costó lo que vendiste y lo que te dejó, sin IVA.">
            <dl className="kpi-grid">
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
              {summary.inventory !== null && <Kpi label="Inventario a costo" value={money(summary.inventory.valueCents)} />}
            </dl>
            {totals.productsWithoutCostSold > 0 && (
              <p className="notice" role="note">
                {totals.productsWithoutCostSold} producto(s) que se vendieron no tienen costo y no cuentan en la utilidad ni en el margen. Se marcan como «sin costo»
                en Más vendidos.
              </p>
            )}
          </Group>
        )}
        <Group id="group-returns" title="Devoluciones y cancelaciones" lead="Lo que regresó a la tienda y las ventas que no se cobraron.">
          <dl className="kpi-grid">
            <Kpi
              label="Devoluciones"
              value={money(totals.returnsCents)}
              detail={`${totals.returnsCount} devolución(es)`}
              compare={compareOf(before, totals.returnsCents, before?.returnsCents ?? null, money)}
            />
            <Kpi label="Cancelaciones" value={String(summary.cancellations.count)} detail={money(summary.cancellations.totalCents)} />
            <Kpi label="Descuentos" value="No aplica" detail="La caja todavía no maneja descuentos" />
          </dl>
        </Group>
      </div>
      <Group id="group-payments" title="Formas de pago" lead="Cómo te pagaron: cada venta una vez, y el dinero por cada medio.">
        <PaymentTables summary={summary} />
      </Group>
      {(summary.cashMovements !== null || summary.byCashier !== null) && <DrawerGroup summary={summary} />}
      <Group id="group-when" title="Cuándo se vende" lead="Las horas, los días y la tendencia del periodo.">
        <SalesCharts summary={summary} />
      </Group>
    </>
  );
}
