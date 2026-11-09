import { formatCents } from '@pos-saas/money';
import { useEffect, useState, type ReactElement } from 'react';

import type { PosApi } from '../../shared/pos-api';
import type { DailyReport, StockAlert } from '../../shared/report-api';
import { formatQuantity } from '../sale/format';
import { Field, Message, useAction } from '../ui/form-parts';
import { useWindowKeys } from '../ui/use-window-keys';

interface ReportViewProps {
  readonly posApi: PosApi;
  readonly onBack: () => void;
}

/** Today in the time zone of the register, as `YYYY-MM-DD`. */
function today(): string {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The report of a day for the owner. It opens on today and reads another day when the owner types it and presses F2.
 *
 * @param props.posApi bridge to the main process
 * @param props.onBack called to go back to the administration summary
 * @returns the view
 */
export function ReportView({ posApi, onBack }: ReportViewProps): ReactElement {
  const [day, setDay] = useState(today);
  const [report, setReport] = useState<DailyReport | null>(null);
  const { isBusy, message, setMessage, run } = useAction();

  const load = (): void =>
    run(async () => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        setMessage('Escribe el día así: 2026-11-08.');
        return;
      }
      try {
        setReport(await posApi.getDailyReport(day));
      } catch {
        setMessage('Ese día no existe. Escríbelo así: 2026-11-08.');
      }
    });

  useEffect(load, []); // eslint-disable-line react-hooks/exhaustive-deps -- only the first load is automatic

  useWindowKeys({ F2: load, Escape: onBack }, isBusy);

  return (
    <>
      <h2 id="admin-title">Reporte del día</h2>
      <Field label="Día" value={day} onChange={setDay} autoFocus maxLength={10} hint="Año-mes-día. F2 para ver otro día." />
      <Message text={message} />
      {report !== null && <ReportBody report={report} />}
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={onBack}>
          Volver <kbd>Esc</kbd>
        </button>
        <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={load}>
          Ver el día <kbd>F2</kbd>
        </button>
      </div>
    </>
  );
}

function ReportBody({ report }: { readonly report: DailyReport }): ReactElement {
  return (
    <>
      <dl className="summary-rows" aria-label="Resumen del día">
        <div>
          <dt>Ventas</dt>
          <dd>{report.salesCount}</dd>
        </div>
        <div>
          <dt>Total vendido</dt>
          <dd>{formatCents(report.totalCents)}</dd>
        </div>
        <div>
          <dt>Ticket promedio</dt>
          <dd>{formatCents(report.averageTicketCents)}</dd>
        </div>
        <div>
          <dt>Devoluciones ({report.returnsCount})</dt>
          <dd>{formatCents(report.returnsCents)}</dd>
        </div>
        <div>
          <dt>Ganancia sobre el costo (sin IVA)</dt>
          <dd>{formatCents(report.marginCents)}</dd>
        </div>
      </dl>
      {report.linesWithoutCost > 0 && (
        <p className="notice" role="note">
          {report.linesWithoutCost} partida(s) no tienen costo conocido y no cuentan en la ganancia. Carga el catálogo de Eleventa con sus costos.
        </p>
      )}
      {report.byHour.length > 0 && (
        <table aria-label="Ventas por hora">
          <thead>
            <tr>
              <th scope="col">Hora</th>
              <th scope="col">Ventas</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {report.byHour.map((row) => (
              <tr key={row.hour}>
                <td>{String(row.hour).padStart(2, '0')}:00</td>
                <td>{row.salesCount}</td>
                <td>{formatCents(row.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {report.byCashier.length > 0 && (
        <table aria-label="Ventas por cajero">
          <thead>
            <tr>
              <th scope="col">Cajero</th>
              <th scope="col">Ventas</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {report.byCashier.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>{row.salesCount}</td>
                <td>{formatCents(row.totalCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <AlertList title="Agotados o en negativo" alerts={report.outOfStock} />
      <AlertList title="Con existencia pero sin venta en 30 días" alerts={report.notSelling} />
    </>
  );
}

function AlertList({ title, alerts }: { readonly title: string; readonly alerts: readonly StockAlert[] }): ReactElement | null {
  if (alerts.length === 0) {
    return null;
  }
  return (
    <section aria-label={title}>
      <h3>{title}</h3>
      <ul>
        {alerts.map((alert) => (
          <li key={alert.productId}>
            {alert.name}: {alert.stockMilli < 0 ? '−' : ''}
            {formatQuantity({ milli: Math.abs(alert.stockMilli), unit: alert.unit })}
          </li>
        ))}
      </ul>
    </section>
  );
}
