import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import type { UserSummary } from '../../shared/auth';
import {
  PERIOD_KINDS,
  type DashboardApi,
  type DashboardRequest,
  type DashboardResult,
  type DashboardSummary,
  type ExportFormat,
  type ExportResult,
  type PeriodKind,
  type TopLimit,
  type TopMetric,
} from '../../shared/dashboard-api';
import { periodLabel } from '../../shared/dashboard-format';
import { Field, Message } from '../ui/form-parts';
import { ModalDialog } from '../ui/ModalDialog';
import { useWindowKeys } from '../ui/use-window-keys';
import { InventoryTab } from './InventoryTab';
import { isDayText, movePeriod, todayInRegisterZone } from './period-input';
import { SummaryTab } from './SummaryTab';
import { TopSellersTab } from './TopSellersTab';

const PERIOD_NAMES: Readonly<Record<PeriodKind, string>> = {
  day: 'Día',
  week: 'Semana',
  month: 'Mes',
  year: 'Año',
  custom: 'Rango',
};

type TabName = 'summary' | 'top' | 'inventory';

const TABS: readonly { readonly name: TabName; readonly label: string; readonly ownerOnly: boolean }[] = [
  { name: 'summary', label: 'Resumen', ownerOnly: false },
  { name: 'top', label: 'Más vendidos', ownerOnly: false },
  { name: 'inventory', label: 'Inventario', ownerOnly: true },
];

interface DashboardDialogProps {
  readonly api: DashboardApi;
  readonly user: UserSummary;
  readonly onClose: () => void;
}

function refusalText(result: Exclude<DashboardResult, { status: 'ok' }> | Extract<ExportResult, { status: 'wrong_pin' | 'locked' }>): string {
  return result.status === 'locked'
    ? 'Demasiados intentos con el PIN. Espera unos minutos.'
    : `El PIN no es correcto. Te quedan ${result.attemptsLeft} intento(s).`;
}

/**
 * The summary of the business: indicators, charts, best sellers and the state of the stock for a day, a week, a month, a
 * year or a range, compared with the period before. The owner sees everything. A cashier sees only the sales of their own
 * shift, without costs, and can type the PIN of an owner to see the whole summary. It works with no internet: everything
 * comes from the register's own database.
 *
 * @param props.api bridge to the main process
 * @param props.user who is signed in
 * @param props.onClose called when the person is done
 * @returns the dialog
 */
export function DashboardDialog({ api, user, onClose }: DashboardDialogProps): ReactElement {
  const isOwner = user.role === 'owner';
  const [period, setPeriod] = useState<PeriodKind>('day');
  const [date, setDate] = useState(() => todayInRegisterZone());
  const [endDate, setEndDate] = useState(() => todayInRegisterZone());
  const [topMetric, setTopMetric] = useState<TopMetric>('quantity');
  const [topLimit, setTopLimit] = useState<TopLimit>(10);
  const [ownerPin, setOwnerPin] = useState<string | null>(null);
  const [pinText, setPinText] = useState('');
  const [isAskingPin, setIsAskingPin] = useState(false);
  const [tab, setTab] = useState<TabName>('summary');
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  /** Why the PIN was not accepted. It stays until another PIN is typed, because the view goes back to the shift by itself. */
  const [pinMessage, setPinMessage] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const latest = useRef(0);

  const hasFullAccess = isOwner || ownerPin !== null;
  const dayProblem = !isDayText(date) || (period === 'custom' && (!isDayText(endDate) || endDate < date));

  const buildRequest = useCallback(
    (): DashboardRequest => ({
      period,
      date,
      ...(period === 'custom' ? { endDate } : {}),
      topMetric,
      topLimit,
      ...(ownerPin === null ? {} : { ownerPin }),
    }),
    [period, date, endDate, topMetric, topLimit, ownerPin],
  );

  const load = useCallback(() => {
    if (dayProblem) {
      return;
    }
    const ticket = latest.current + 1;
    latest.current = ticket;
    setIsLoading(true);
    api.getDashboard(buildRequest()).then(
      (result) => {
        if (ticket !== latest.current) {
          return;
        }
        setIsLoading(false);
        if (result.status === 'ok') {
          setSummary(result.summary);
          setMessage(null);
          return;
        }
        // A wrong PIN leaves the shift view in place and says why the full summary did not open.
        setOwnerPin(null);
        setPinMessage(refusalText(result));
      },
      () => {
        if (ticket === latest.current) {
          setIsLoading(false);
          setMessage('No se pudo leer el resumen. Intenta de nuevo y, si sigue igual, reinicia la caja.');
        }
      },
    );
  }, [api, buildRequest, dayProblem]);

  useEffect(load, [load]);

  const exportAs = (format: ExportFormat): void => {
    if (isExporting || summary === null) {
      return;
    }
    setIsExporting(true);
    setNote(null);
    api.exportDashboard(buildRequest(), format).then(
      (result) => {
        setIsExporting(false);
        if (result.status === 'saved') {
          setNote(`Listo. El archivo quedó en ${result.path}`);
        } else if (result.status === 'failed') {
          setMessage(result.message);
        } else if (result.status === 'wrong_pin' || result.status === 'locked') {
          setOwnerPin(null);
          setPinMessage(refusalText(result));
        }
      },
      () => {
        setIsExporting(false);
        setMessage('No se pudo guardar el archivo.');
      },
    );
  };

  const submitPin = (): void => {
    if (pinText.trim() === '') {
      return;
    }
    setMessage(null);
    setPinMessage(null);
    setOwnerPin(pinText.trim());
    setPinText('');
    setIsAskingPin(false);
  };

  const step = (direction: -1 | 1): void => {
    if (dayProblem) {
      return;
    }
    const moved = movePeriod(period, date, endDate, direction);
    setDate(moved.date);
    setEndDate(moved.endDate);
  };

  useWindowKeys(
    {
      F2: load,
      F3: () => exportAs('xlsx'),
      F4: () => exportAs('pdf'),
      Escape: isAskingPin ? () => setIsAskingPin(false) : onClose,
    },
    isExporting,
  );

  const visibleTabs = TABS.filter((candidate) => !candidate.ownerOnly || summary?.inventory != null);
  const activeTab = visibleTabs.some((candidate) => candidate.name === tab) ? tab : 'summary';
  const isShift = summary?.scope === 'shift';

  return (
    <ModalDialog titleId="dashboard-title" className="dashboard">
      <h2 id="dashboard-title">{isShift ? 'Mi turno' : 'Resumen del negocio'}</h2>
      {summary !== null && <p className="dashboard-period">{isShift ? `Desde que abrió tu caja · ${periodLabel(summary.period)}` : periodLabel(summary.period)}</p>}
      <Message text={message} />
      <Message text={pinMessage} />
      {note !== null && (
        <p className="notice notice-info" role="status">
          {note}
        </p>
      )}
      {hasFullAccess && (
        <div className="dashboard-controls">
          <div role="group" aria-label="Periodo" className="segmented">
            {PERIOD_KINDS.map((kind) => (
              <button key={kind} type="button" className="segment" aria-pressed={kind === period} onClick={() => setPeriod(kind)}>
                {PERIOD_NAMES[kind]}
              </button>
            ))}
          </div>
          <button type="button" className="button" onClick={() => step(-1)} aria-label="Periodo anterior">
            ◀
          </button>
          <label className="date-field">
            <span>{period === 'custom' ? 'Desde' : 'Día de referencia'}</span>
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-invalid={dayProblem} />
          </label>
          {period === 'custom' && (
            <label className="date-field">
              <span>Hasta</span>
              <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} aria-invalid={dayProblem} />
            </label>
          )}
          <button type="button" className="button" onClick={() => step(1)} aria-label="Periodo siguiente">
            ▶
          </button>
          <button
            type="button"
            className="button"
           
            onClick={() => {
              setDate(todayInRegisterZone());
              setEndDate(todayInRegisterZone());
            }}
          >
            Hoy
          </button>
        </div>
      )}
      {dayProblem && hasFullAccess && (
        <p className="notice" role="alert">
          Revisa las fechas. La segunda no puede ser antes que la primera.
        </p>
      )}
      {!hasFullAccess && !isAskingPin && (
        <p className="notice notice-info" role="note">
          Aquí ves las ventas de tu turno.{' '}
          <button type="button" className="link-button" onClick={() => setIsAskingPin(true)}>
            Ver el resumen completo con el PIN del dueño
          </button>
        </p>
      )}
      {isAskingPin && (
        <div className="dashboard-pin">
          <Field label="PIN del dueño" type="password" value={pinText} onChange={setPinText} autoFocus maxLength={8} onEnter={submitPin} hint="Enter para entrar. Esc para cancelar." />
        </div>
      )}
      <div role="tablist" aria-label="Secciones" className="tabs">
        {visibleTabs.map((candidate) => (
          <button
            key={candidate.name}
            type="button"
            role="tab"
            id={`tab-${candidate.name}`}
            aria-selected={candidate.name === activeTab}
            aria-controls="dashboard-panel"
           
            className="tab"
            onClick={() => setTab(candidate.name)}
          >
            {candidate.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="dashboard-panel" aria-labelledby={`tab-${activeTab}`} aria-busy={isLoading} className="dashboard-panel">
        {summary === null ? (
          <p className="sale-empty">{isLoading ? 'Calculando…' : 'Sin datos.'}</p>
        ) : activeTab === 'summary' ? (
          <SummaryTab summary={summary} />
        ) : activeTab === 'top' ? (
          <TopSellersTab summary={summary} metric={topMetric} limit={topLimit} onMetricChange={setTopMetric} onLimitChange={setTopLimit} />
        ) : summary.inventory !== null ? (
          <InventoryTab inventory={summary.inventory} />
        ) : null}
      </div>
      <div className="payment-actions">
        <button type="button" className="button" onClick={onClose}>
          Volver <kbd>Esc</kbd>
        </button>
        <button type="button" className="button" disabled={isLoading} onClick={load}>
          Actualizar <kbd>F2</kbd>
        </button>
        <button type="button" className="button" disabled={isExporting || summary === null} onClick={() => exportAs('xlsx')}>
          Excel <kbd>F3</kbd>
        </button>
        <button type="button" className="button button-primary" disabled={isExporting || summary === null} onClick={() => exportAs('pdf')}>
          PDF <kbd>F4</kbd>
        </button>
      </div>
    </ModalDialog>
  );
}
