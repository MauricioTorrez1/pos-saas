import { useCallback, useEffect, useState, type ReactElement } from 'react';

import {
  MAX_MISSING_DESCRIPTION,
  MAX_MISSING_NOTES,
  MISSING_PERIOD_CHOICES,
  MISSING_PERIOD_LABELS,
  MISSING_STATUS_LABELS,
  type MissingItemGroup,
  type MissingItemsApi,
  type MissingItemsReport,
  type MissingPeriod,
  type MissingStatus,
} from '../../shared/missing-items';
import { BarChart, type Bar } from '../dashboard/BarChart';
import { Field, Message, SelectField, useAction } from '../ui/form-parts';
import { Modal } from '../ui/Modal';

const WEEKDAY_NAMES = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'] as const;
const SHORT_DAY = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short' });
/** The most asked items the list shows; the PDF has all of them. */
const TOP_SHOWN = 30;

interface MissingItemsDialogProps {
  readonly api: MissingItemsApi;
  readonly isOwner: boolean;
  /** What the cashier looked for and did not find, to write it down without typing it again. */
  readonly initialDescription?: string;
  readonly onClose: () => void;
}

function times(count: number): string {
  return count === 1 ? '1 vez' : `${String(count)} veces`;
}

function weekLabel(key: string): string {
  const [year, month, day] = key.split('-').map(Number);
  return SHORT_DAY.format(new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

/**
 * The log of missing items (E1-49): what customers ask for that the store does not carry. The cashier writes it down
 * with Enter; the owner sees what is asked for most, marks what is already sold or dismissed, and saves it as a PDF.
 *
 * @param props.api the bridge of the log
 * @param props.isOwner whether the person may decide about an item
 * @param props.initialDescription what to start the description with
 * @param props.onClose closes the dialog
 * @returns the dialog
 */
export function MissingItemsDialog({ api, isOwner, initialDescription = '', onClose }: MissingItemsDialogProps): ReactElement {
  const [description, setDescription] = useState(initialDescription.slice(0, MAX_MISSING_DESCRIPTION));
  const [quantity, setQuantity] = useState('');
  const [notes, setNotes] = useState('');
  const [period, setPeriod] = useState<MissingPeriod>(30);
  const [report, setReport] = useState<MissingItemsReport | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const { isBusy, message, setMessage, run } = useAction();

  const refresh = useCallback(() => {
    api.report(period).then(setReport, () => setMessage('No se pudo leer la bitácora de faltantes.'));
  }, [api, period, setMessage]);

  useEffect(refresh, [refresh]);

  const save = (): void => {
    run(async () => {
      const result = await api.record({ description, quantity: quantity === '' ? null : Number(quantity), notes: notes.trim() === '' ? null : notes });
      if (result.status === 'invalid') {
        setMessage(result.message);
        return;
      }
      setInfo(`Anotado: «${description.trim()}». Ya lo han pedido ${times(result.timesAsked)}.`);
      setDescription('');
      setQuantity('');
      setNotes('');
      refresh();
    });
  };

  const decide = (group: MissingItemGroup, status: MissingStatus): void => {
    run(async () => {
      await api.resolve({ key: group.key, status });
      refresh();
    });
  };

  const exportPdf = (): void => {
    run(async () => {
      const result = await api.exportPdf(period);
      if (result.status === 'saved') {
        setInfo(`PDF guardado en ${result.path}`);
      } else if (result.status === 'failed') {
        setMessage(result.message);
      }
    });
  };

  const weekBars: Bar[] = (report?.byWeek ?? []).map((week) => ({ key: week.key, label: weekLabel(week.key), value: week.count, valueLabel: String(week.count) }));
  const weekdayBars: Bar[] = (report?.byWeekday ?? []).map((day) => ({ key: day.key, label: WEEKDAY_NAMES[Number(day.key)] ?? '', value: day.count, valueLabel: String(day.count) }));
  const peak = Math.max(1, ...(report?.groups ?? []).map((group) => group.timesAsked));

  return (
    <Modal title="Faltantes" className="missing-items" onClose={onClose}>
      <section className="missing-form" aria-label="Anotar un faltante">
        <p className="dialog-hint">Lo que un cliente pidió y no tenemos. Con Enter queda anotado.</p>
        <Field label="¿Qué pidió el cliente?" value={description} onChange={setDescription} autoFocus maxLength={MAX_MISSING_DESCRIPTION} onEnter={save} />
        <div className="missing-form-row">
          <Field label="Cantidad que quería (opcional)" value={quantity} onChange={setQuantity} numeric="integer" maxLength={5} onEnter={save} />
          <Field label="Notas: marca, medida, color (opcional)" value={notes} onChange={setNotes} maxLength={MAX_MISSING_NOTES} onEnter={save} />
        </div>
        <button type="button" className="button button-primary" disabled={isBusy || description.trim() === ''} onClick={save}>
          Anotar faltante
        </button>
      </section>
      <Message text={message} />
      {info !== null && (
        <p className="notice notice-info" role="status">
          {info}
        </p>
      )}
      <section className="missing-report" aria-label="Lo que más piden">
        <div className="missing-toolbar">
          <SelectField
            label="Periodo"
            value={String(period)}
            onChange={(value) => setPeriod(Number(value) as MissingPeriod)}
            options={MISSING_PERIOD_CHOICES.map((choice) => ({ value: String(choice), label: MISSING_PERIOD_LABELS[choice] }))}
          />
          <button type="button" className="button" disabled={isBusy || report === null} onClick={exportPdf}>
            Descargar PDF con gráficas
          </button>
        </div>
        {report !== null && (
          <>
            <ul className="kpis" aria-label="Totales del periodo">
              <li>
                <strong>{report.totalRequests}</strong> veces pidieron algo que no había
              </li>
              <li>
                <strong>{report.groups.length}</strong> productos distintos
              </li>
              <li>
                <strong>{report.groups.filter((group) => group.status === 'pending').length}</strong> pendientes de decidir
              </li>
            </ul>
            {report.groups.length === 0 ? (
              <p className="empty-state">No se anotó ningún faltante en este periodo.</p>
            ) : (
              <>
                <ol className="missing-list scroll-area" aria-label="Faltantes, lo más pedido primero">
                  {report.groups.slice(0, TOP_SHOWN).map((group) => (
                    <li key={group.key} className="missing-row" data-status={group.status}>
                      <div className="missing-row-text">
                        <strong>{group.description}</strong>
                        <span className="badge">{MISSING_STATUS_LABELS[group.status]}</span>
                        <small>
                          {times(group.timesAsked)}
                          {group.quantityAsked > 0 ? ` · querían ${String(group.quantityAsked)}` : ''}
                          {group.notes.length > 0 ? ` · ${group.notes.join('; ')}` : ''}
                        </small>
                        <span className="missing-meter" aria-hidden="true">
                          <span style={{ width: `${String(Math.round((group.timesAsked / peak) * 100))}%` }} />
                        </span>
                      </div>
                      {isOwner && (
                        <div className="missing-row-actions">
                          {group.status !== 'added' && (
                            <button type="button" className="button" disabled={isBusy} onClick={() => decide(group, 'added')}>
                              Ya lo vendemos
                            </button>
                          )}
                          {group.status !== 'dismissed' && (
                            <button type="button" className="button" disabled={isBusy} onClick={() => decide(group, 'dismissed')}>
                              Descartar
                            </button>
                          )}
                          {group.status !== 'pending' && (
                            <button type="button" className="button" disabled={isBusy} onClick={() => decide(group, 'pending')}>
                              Volver a pendiente
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
                <BarChart title="Veces por semana" bars={weekBars} columns={['Semana del', 'Veces']} emptyText="Nadie pidió nada que faltara." />
                <BarChart title="Veces por día de la semana" bars={weekdayBars} columns={['Día', 'Veces']} emptyText="Nadie pidió nada que faltara." />
              </>
            )}
          </>
        )}
      </section>
    </Modal>
  );
}
