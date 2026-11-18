import { useEffect, useRef, useState, type ReactElement } from 'react';

import type { DashboardApi } from '../../shared/dashboard-api';
import { percentLabel, periodLabel, pesosLabel } from '../../shared/dashboard-format';
import { GENERAL_LINES, taxRateLabel, type IncomeStatement, type StatementLine, type StatementRequest } from '../../shared/income-statement';

type View = 'general' | 'detail';

interface IncomeStatementTabProps {
  readonly api: Pick<DashboardApi, 'getIncomeStatement'>;
  /** The period to read, as the dialog builds it, «Desde el inicio» included. */
  readonly request: StatementRequest;
  /** Whether the statement goes «Desde el inicio» instead of the period chosen above. */
  readonly sinceStart: boolean;
  readonly onSinceStartChange: (sinceStart: boolean) => void;
  /** Changes when the dialog asks to read everything again, such as after F2 or a new expense. */
  readonly refreshKey: number;
}

const shareText = (line: StatementLine): string => (line.shareBp === null ? 'sin datos' : percentLabel(line.shareBp));

function GeneralView({ statement }: { readonly statement: IncomeStatement }): ReactElement {
  return (
    <table className="dashboard-table statement-table" aria-label="Estado de resultados, vista general">
      <thead>
        <tr>
          <th scope="col">Renglón</th>
          <th scope="col">Monto</th>
          <th scope="col">% de las ventas netas</th>
        </tr>
      </thead>
      <tbody>
        {GENERAL_LINES.map((line) => {
          const value = statement[line.key];
          return (
            <tr key={line.key} className={line.isResult ? 'statement-result' : undefined}>
              <th scope="row">
                <span className="statement-label">{line.label}</span>
                <span className="statement-explanation">{line.explanation}</span>
              </th>
              <td className={value.amountCents < 0 ? 'amount-negative' : undefined}>{pesosLabel(value.amountCents)}</td>
              <td>{shareText(value)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function DetailView({ statement }: { readonly statement: IncomeStatement }): ReactElement {
  const { detail } = statement;
  return (
    <>
      <table className="dashboard-table" aria-label="Ventas por tasa de IVA">
        <caption>Ventas netas por tasa de IVA (sin IVA)</caption>
        <thead>
          <tr>
            <th scope="col">Tasa</th>
            <th scope="col">Vendido</th>
            <th scope="col">Devuelto</th>
            <th scope="col">Neto</th>
          </tr>
        </thead>
        <tbody>
          {detail.byTaxRate.map((rate) => (
            <tr key={`${rate.factor}-${String(rate.rateBp)}`}>
              <th scope="row">{taxRateLabel(rate)}</th>
              <td>{pesosLabel(rate.soldCents)}</td>
              <td>{pesosLabel(rate.returnedCents)}</td>
              <td>{pesosLabel(rate.netCents)}</td>
            </tr>
          ))}
          <tr>
            <th scope="row">Descuentos</th>
            <td colSpan={3}>{pesosLabel(statement.discounts.amountCents)} · la caja todavía no maneja descuentos</td>
          </tr>
          <tr className="statement-result">
            <th scope="row">Ventas netas</th>
            <td>{pesosLabel(statement.grossSales.amountCents)}</td>
            <td>{pesosLabel(statement.returns.amountCents)}</td>
            <td>{pesosLabel(statement.netSales.amountCents)}</td>
          </tr>
        </tbody>
      </table>
      <table className="dashboard-table" aria-label="Costo de lo vendido por producto">
        <caption>Costo de lo vendido: los productos que más costaron</caption>
        <thead>
          <tr>
            <th scope="col">Producto</th>
            <th scope="col">Costo</th>
          </tr>
        </thead>
        <tbody>
          {detail.costByProduct.map((line) => (
            <tr key={line.name}>
              <th scope="row">{line.name}</th>
              <td>{pesosLabel(line.costCents)}</td>
            </tr>
          ))}
          {detail.costByProduct.length === 0 && (
            <tr>
              <td colSpan={2}>No hay costo en este periodo.</td>
            </tr>
          )}
          <tr className="statement-result">
            <th scope="row">Costo de lo vendido</th>
            <td>{pesosLabel(statement.costOfGoods.amountCents)}</td>
          </tr>
        </tbody>
      </table>
      <table className="dashboard-table" aria-label="Gastos de operación por concepto">
        <caption>Gastos de operación por concepto</caption>
        <thead>
          <tr>
            <th scope="col">Concepto</th>
            <th scope="col">Monto</th>
            <th scope="col">Veces</th>
            <th scope="col">Pagado de la caja</th>
          </tr>
        </thead>
        <tbody>
          {detail.expensesByConcept.map((line) => (
            <tr key={line.concept}>
              <th scope="row">{line.concept}</th>
              <td>{pesosLabel(line.amountCents)}</td>
              <td>{line.count}</td>
              <td>{pesosLabel(line.fromDrawerCents)}</td>
            </tr>
          ))}
          {detail.expensesByConcept.length === 0 && (
            <tr>
              <td colSpan={4}>No hay gastos anotados en este periodo. Anótalos en la pestaña «Gastos».</td>
            </tr>
          )}
          <tr className="statement-result">
            <th scope="row">Gastos de operación</th>
            <td>{pesosLabel(statement.operatingExpenses.amountCents)}</td>
            <td colSpan={2} />
          </tr>
        </tbody>
      </table>
    </>
  );
}

/**
 * «Estado de resultados»: whether the business earns after its costs and its expenses, before income tax and without
 * VAT, in a general view with a sentence under each line and a detailed one (E1-56, ADR 0072). Only an owner sees it, or a
 * cashier who typed the PIN of one.
 *
 * @param props.api reads the statement from the main process
 * @param props.request the period and the PIN
 * @param props.sinceStart whether it goes «Desde el inicio»
 * @param props.onSinceStartChange switches between the chosen period and «Desde el inicio»
 * @param props.refreshKey changes to read it again
 * @returns the tab
 */
export function IncomeStatementTab({ api, request, sinceStart, onSinceStartChange, refreshKey }: IncomeStatementTabProps): ReactElement {
  const [view, setView] = useState<View>('general');
  const [statement, setStatement] = useState<IncomeStatement | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const latest = useRef(0);
  const { period, date, endDate, ownerPin } = request;

  useEffect(() => {
    const ticket = latest.current + 1;
    latest.current = ticket;
    const asked: StatementRequest = { period, date, ...(endDate === undefined ? {} : { endDate }), ...(ownerPin === undefined ? {} : { ownerPin }) };
    api.getIncomeStatement(asked).then(
      (result) => {
        if (ticket !== latest.current) {
          return;
        }
        if (result.status === 'ok') {
          setStatement(result.statement);
          setMessage(null);
        } else {
          setStatement(null);
          setMessage(result.status === 'locked' ? 'Demasiados intentos con el PIN. Espera unos minutos.' : 'El estado de resultados es solo para el dueño.');
        }
      },
      () => {
        if (ticket === latest.current) {
          setMessage('No se pudo calcular el estado de resultados. Intenta de nuevo.');
        }
      },
    );
  }, [api, period, date, endDate, ownerPin, refreshKey]);

  return (
    <section className="statement" aria-label="Estado de resultados">
      <div className="dashboard-controls">
        <div role="group" aria-label="Periodo del estado" className="segmented">
          <button type="button" className="segment" aria-pressed={!sinceStart} onClick={() => onSinceStartChange(false)}>
            Periodo elegido
          </button>
          <button type="button" className="segment" aria-pressed={sinceStart} onClick={() => onSinceStartChange(true)}>
            Desde el inicio
          </button>
        </div>
        <div role="group" aria-label="Vista" className="segmented">
          <button type="button" className="segment" aria-pressed={view === 'general'} onClick={() => setView('general')}>
            General
          </button>
          <button type="button" className="segment" aria-pressed={view === 'detail'} onClick={() => setView('detail')}>
            Detallado
          </button>
        </div>
      </div>
      {message !== null && (
        <p className="notice" role="alert">
          {message}
        </p>
      )}
      {statement === null ? (
        message === null && <p className="sale-empty">Calculando…</p>
      ) : (
        <>
          <p className="dashboard-period">{periodLabel(statement.period)} · antes de ISR, todos los montos sin IVA</p>
          {!statement.hasActivity && (
            <p className="notice notice-info" role="note">
              No hubo ventas, devoluciones ni gastos en este periodo.
            </p>
          )}
          {view === 'general' ? <GeneralView statement={statement} /> : <DetailView statement={statement} />}
          {statement.uncosted.productCount > 0 && (
            <p className="notice" role="note">
              {statement.uncosted.productCount} producto(s) se vendieron sin costo por {pesosLabel(statement.uncosted.netSalesCents)} sin IVA. Su venta sí cuenta,
              pero su costo no, así que la utilidad sale más alta de lo real. Captura su costo en el producto.
            </p>
          )}
          <ul className="statement-notes">
            <li>
              IVA cobrado: {pesosLabel(statement.vatCollectedCents)}. No es tuyo: se le paga al SAT, por eso no está en las ventas.
            </li>
            <li>Las comisiones de la tarjeta cuentan cuando las anotas en «Gastos» con el concepto «Comisiones del banco».</li>
          </ul>
        </>
      )}
    </section>
  );
}
