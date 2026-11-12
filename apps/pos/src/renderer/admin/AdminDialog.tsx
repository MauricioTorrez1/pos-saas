import { formatCents } from '@pos-saas/money';
import { useEffect, useState, type ReactElement } from 'react';

import type { BackupOutcome, BackupStatus, ImportOutcome, ImportReportView } from '../../shared/admin-api';
import type { PosApi } from '../../shared/pos-api';
import type { PricingApi } from '../../shared/pricing';
import type { ProductAdminApi } from '../../shared/product-admin';
import { Field, Message, useAction } from '../ui/form-parts';
import { ModalDialog } from '../ui/ModalDialog';
import { InventoryView } from './InventoryView';
import { ReportView } from './ReportView';
import { useWindowKeys } from '../ui/use-window-keys';

const MOMENT = new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' });
const SHOWN_INVALID_ROWS = 10;

type View =
  | { readonly kind: 'summary' }
  | { readonly kind: 'passphrase'; readonly purpose: 'configure' | 'restore' }
  | { readonly kind: 'imported'; readonly report: ImportReportView }
  | { readonly kind: 'inventory' }
  | { readonly kind: 'report' };

interface AdminDialogProps {
  readonly posApi: PosApi;
  /** The prices of the catalog. Without it, the product view offers no price change. */
  readonly pricingApi?: PricingApi;
  /** Finding and editing products. Without it, the inventory offers no product panel. */
  readonly productApi?: ProductAdminApi;
  /** Opens the summary of the business, which closes this dialog. Without it, the menu does not offer the summary. */
  readonly onOpenDashboard?: () => void;
  /** Opens the orders to suppliers (E1-44). Without it, the administration offers none. */
  readonly onOpenSupplierOrder?: () => void;
  readonly onClose: () => void;
}

/**
 * What only the owner does: load the catalog and the stock of Eleventa, set up the encrypted backups, make one now, and
 * restore one. Everything is from the keyboard, and the windows to choose a file or a folder are the ones of Windows.
 *
 * @param props.posApi bridge to the main process
 * @param props.pricingApi bridge for changing prices, when the register offers it
 * @param props.productApi bridge for the product panel, when the register offers it
 * @param props.onOpenDashboard called to open the summary of the business, when the register offers it
 * @param props.onOpenSupplierOrder opens the orders to suppliers, when the register offers them
 * @param props.onClose called when the dialog is done
 * @returns the dialog
 */
export function AdminDialog({ posApi, pricingApi, productApi, onOpenDashboard, onOpenSupplierOrder, onClose }: AdminDialogProps): ReactElement {
  const [view, setView] = useState<View>({ kind: 'summary' });
  const [backup, setBackup] = useState<BackupStatus | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const { isBusy, message, setMessage, run } = useAction();

  useEffect(() => {
    posApi.getBackupStatus().then(setBackup, () => setMessage('No se pudo leer el estado de los respaldos.'));
  }, [posApi, setMessage]);

  const importCatalog = (): void =>
    run(async () => {
      setNote(null);
      const outcome: ImportOutcome = await posApi.importCatalog();
      if (outcome.status === 'done') {
        setView({ kind: 'imported', report: outcome.report });
      } else if (outcome.status === 'unreadable') {
        setMessage(outcome.message);
      }
    });

  const backupNow = (): void =>
    run(async () => {
      setNote(null);
      const outcome = await posApi.backupNow();
      showBackup(outcome);
    });

  const checkLedger = (): void =>
    run(async () => {
      setNote(null);
      const check = await posApi.checkLedger();
      if (check.problems.length === 0) {
        setNote(`Todo cuadra: ${check.checkedMovements} movimientos revisados contra las ventas y las devoluciones.`);
      } else {
        setMessage(`${check.problems.length} movimiento(s) no cuadran con las ventas. No vendas con esta base y avisa a soporte.`);
      }
    });

  const showBackup = (outcome: BackupOutcome): void => {
    if ('backup' in outcome) {
      setBackup(outcome.backup);
    }
    if (outcome.status === 'done') {
      setNote('Copia hecha. Ya está guardada y cifrada.');
    } else if (outcome.status === 'not_configured') {
      setMessage('Todavía no hay respaldos configurados. Oprime F6 para empezar.');
    } else if (outcome.status === 'failed') {
      setMessage(outcome.message);
    } else if (outcome.status === 'weak_passphrase') {
      setMessage('La contraseña necesita al menos 8 caracteres.');
    }
  };

  useWindowKeys(
    view.kind === 'summary'
      ? {
          F2: () => setView({ kind: 'inventory' }),
          F3: checkLedger,
          F4: () => setView({ kind: 'report' }),
          F5: importCatalog,
          F6: () => setView({ kind: 'passphrase', purpose: 'configure' }),
          F7: backupNow,
          F8: () => setView({ kind: 'passphrase', purpose: 'restore' }),
          F9: onOpenDashboard,
          F11: onOpenSupplierOrder,
          Escape: onClose,
        }
      : view.kind === 'imported'
        ? { Enter: () => setView({ kind: 'summary' }), Escape: () => setView({ kind: 'summary' }) }
        : {},
    isBusy,
  );

  return (
    <ModalDialog titleId="admin-title" className="cash">
      {view.kind === 'inventory' ? (
        <InventoryView posApi={posApi} {...(pricingApi === undefined ? {} : { pricingApi })} {...(productApi === undefined ? {} : { productApi })} {...(onOpenSupplierOrder === undefined ? {} : { onOpenSupplierOrder })} onBack={() => setView({ kind: 'summary' })} />
      ) : view.kind === 'report' ? (
        <ReportView posApi={posApi} onBack={() => setView({ kind: 'summary' })} />
      ) : view.kind === 'passphrase' ? (
        <PassphraseView
          posApi={posApi}
          purpose={view.purpose}
          onBack={() => setView({ kind: 'summary' })}
          onBackup={(outcome) => {
            showBackup(outcome);
            setView({ kind: 'summary' });
          }}
          onStaged={() => {
            setNote('El respaldo está listo. Cierra la caja y ábrela otra vez para usarlo.');
            setView({ kind: 'summary' });
          }}
        />
      ) : view.kind === 'imported' ? (
        <ImportedView report={view.report} onDone={() => setView({ kind: 'summary' })} />
      ) : (
        <>
          <h2 id="admin-title">Administración</h2>
          <BackupSummary backup={backup} />
          {note !== null && (
            <p className="notice notice-info" role="status">
              {note}
            </p>
          )}
          <Message text={message} />
          <ul className="cash-actions">
            <li>
              <kbd>F2</kbd> Inventario: ver el historial de un producto, registrar mermas y ajustes
            </li>
            <li>
              <kbd>F3</kbd> Revisar que el inventario cuadre con las ventas
            </li>
            <li>
              <kbd>F4</kbd> Reporte del día: ventas, ticket promedio, ganancia, agotados
            </li>
            {onOpenDashboard !== undefined && (
              <li>
                <kbd>F9</kbd> Resumen del negocio: indicadores, gráficas, más vendidos y existencias (también con F11 en la venta)
              </li>
            )}
            <li>
              <kbd>F5</kbd> Cargar el catálogo y las existencias de Eleventa
            </li>
            <li>
              <kbd>F6</kbd> Configurar los respaldos (carpeta y contraseña)
            </li>
            <li>
              <kbd>F7</kbd> Hacer una copia ahora
            </li>
            <li>
              <kbd>F8</kbd> Restaurar un respaldo
            </li>
            {onOpenSupplierOrder !== undefined && (
              <li>
                <kbd>F11</kbd> Pedido al proveedor: armarlo, guardarlo y sacarlo en Excel o PDF
              </li>
            )}
            <li>
              <kbd>Esc</kbd> Volver a la venta
            </li>
          </ul>
        </>
      )}
    </ModalDialog>
  );
}

function BackupSummary({ backup }: { readonly backup: BackupStatus | null }): ReactElement | null {
  if (backup === null) {
    return null;
  }
  if (backup.folder === null) {
    return (
      <p className="notice" role="alert">
        No hay respaldos configurados. Si la computadora se descompone, se pierden las ventas.
      </p>
    );
  }
  return (
    <>
      <p className="quantity-price">
        Respaldos en {backup.folder} · Última copia: {backup.lastBackupAt === null ? 'todavía ninguna' : MOMENT.format(new Date(backup.lastBackupAt))}
      </p>
      {backup.lastError !== null && (
        <p className="notice" role="alert">
          La última copia falló. Revisa que la USB o la carpeta estén conectadas.
        </p>
      )}
    </>
  );
}

interface PassphraseViewProps {
  readonly posApi: PosApi;
  readonly purpose: 'configure' | 'restore';
  readonly onBack: () => void;
  readonly onBackup: (outcome: BackupOutcome) => void;
  readonly onStaged: () => void;
}

function PassphraseView({ posApi, purpose, onBack, onBackup, onStaged }: PassphraseViewProps): ReactElement {
  const [passphrase, setPassphrase] = useState('');
  const { isBusy, message, setMessage, run } = useAction();

  const submit = (): void => {
    if ([...passphrase].length < 8) {
      setMessage('La contraseña necesita al menos 8 caracteres.');
      return;
    }
    run(async () => {
      if (purpose === 'configure') {
        onBackup(await posApi.configureBackup({ passphrase }));
        return;
      }
      const outcome = await posApi.restoreBackup({ passphrase });
      if (outcome.status === 'staged') {
        onStaged();
      } else if (outcome.status === 'failed') {
        setMessage(outcome.message);
      } else {
        onBack();
      }
    });
  };

  useWindowKeys({ F2: submit, Escape: onBack }, isBusy);

  return (
    <>
      <h2 id="admin-title">{purpose === 'configure' ? 'Configurar los respaldos' : 'Restaurar un respaldo'}</h2>
      <p>
        {purpose === 'configure'
          ? 'Escribe una contraseña para cifrar las copias, y luego elige la carpeta o la USB. Guárdala en un lugar seguro: sin ella no se puede abrir ninguna copia.'
          : 'Escribe la contraseña con la que se hizo el respaldo, y luego elige el archivo. La caja lo usa cuando la cierres y la abras otra vez, y guarda la base actual por si fue un error.'}
      </p>
      <Field label="Contraseña de los respaldos" value={passphrase} onChange={setPassphrase} type="password" autoFocus maxLength={200} />
      <Message text={message} />
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={onBack}>
          Volver <kbd>Esc</kbd>
        </button>
        <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={submit}>
          Continuar <kbd>F2</kbd>
        </button>
      </div>
    </>
  );
}

function ImportedView({ report, onDone }: { readonly report: ImportReportView; readonly onDone: () => void }): ReactElement {
  return (
    <>
      <h2 id="admin-title">Catálogo cargado</h2>
      <dl className="summary-rows" aria-label="Resultado de la carga">
        <div>
          <dt>Filas leídas</dt>
          <dd>{report.rowsRead}</dd>
        </div>
        <div>
          <dt>Productos nuevos</dt>
          <dd>{report.created}</dd>
        </div>
        <div>
          <dt>Ya estaban en la caja</dt>
          <dd>{report.alreadyThere}</dd>
        </div>
        <div>
          <dt>Existencias iniciales cargadas</dt>
          <dd>{report.openingBalances}</dd>
        </div>
        <div>
          <dt>Costo de lo cargado (compáralo con Eleventa)</dt>
          <dd>{formatCents(report.inventoryValueCents)}</dd>
        </div>
        <div>
          <dt>Productos de prueba quitados</dt>
          <dd>{report.samplesRemoved}</dd>
        </div>
      </dl>
      {report.invalid.length > 0 && (
        <div role="alert" className="notice">
          <p>
            {report.invalid.length} fila(s) no se cargaron. Corrígelas en Eleventa o agrégalas a mano:
          </p>
          <ul>
            {report.invalid.slice(0, SHOWN_INVALID_ROWS).map((row) => (
              <li key={row.line}>
                Línea {row.line}: {row.reason}
              </li>
            ))}
          </ul>
          {report.invalid.length > SHOWN_INVALID_ROWS && <p>Y {report.invalid.length - SHOWN_INVALID_ROWS} más.</p>}
        </div>
      )}
      <button type="button" className="button button-primary" tabIndex={-1} onClick={onDone}>
        Terminar <kbd>Enter</kbd>
      </button>
    </>
  );
}
