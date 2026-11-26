import { cancellationLabel, formatCents, formatDay, mayAskToCancel, periodicityLabel } from '@/lib/invoicing/messages';
import type { CfdiActionState, GlobalSummary } from '@/lib/invoicing/types';
import { CancelForm } from './cfdi-forms';

interface GlobalInvoiceListProps {
  globals: GlobalSummary[];
  /** Given only to the owner, who holds `invoice.cancel` (ADR 0081): it adds the cancel form to each stamped global. */
  cancelAction?: (previous: CfdiActionState, data: FormData) => Promise<CfdiActionState>;
}

const STATUS_LABELS: Record<GlobalSummary['status'], string> = {
  stamped: 'Timbrada',
  pending: 'En proceso',
  failed: 'Rechazada',
};

/**
 * The latest global invoices. One whose sales were later invoiced on their own is flagged: the SAT asks to cancel it
 * with motive 04 and issue it again without those sales.
 */
export function GlobalInvoiceList({ globals, cancelAction }: GlobalInvoiceListProps) {
  if (globals.length === 0) {
    return <p>Todavía no hay facturas globales.</p>;
  }
  return (
    <table className="table" aria-label="Facturas globales">
      <thead>
        <tr>
          <th scope="col">Periodo</th>
          <th scope="col">Estado</th>
          <th scope="col">Ventas</th>
          <th scope="col">Total</th>
          <th scope="col">UUID</th>
          {cancelAction && <th scope="col">Cancelación</th>}
        </tr>
      </thead>
      <tbody>
        {globals.map((global) => (
          <tr key={global.id}>
            <td>
              {periodicityLabel(global.periodicity)}: {formatDay(global.periodStart)} – {formatDay(global.periodEnd)}
            </td>
            <td>
              {STATUS_LABELS[global.status]}
              {global.cancellationStatus && ` · ${cancellationLabel(global.cancellationStatus)}`}
              {global.cancellationMotive && ` (motivo ${global.cancellationMotive})`}
              {global.status === 'pending' && global.errorCode && ' (Facturapi no respondió; vuelve a timbrar ese periodo)'}
              {global.overlappingInvoices > 0 && global.cancellationStatus !== 'accepted' && (
                <strong>
                  {' '}
                  · Por corregir: {global.overlappingInvoices}{' '}
                  {global.overlappingInvoices === 1 ? 'venta se facturó' : 'ventas se facturaron'} aparte. Cancélala con
                  motivo 04 y emítela de nuevo.
                </strong>
              )}
            </td>
            <td>{global.saleCount}</td>
            <td>{formatCents(global.totalCents ?? global.expectedTotalCents)}</td>
            <td className="mono">{global.fiscalUuid ?? '—'}</td>
            {cancelAction && (
              <td>
                {(mayAskToCancel(global.status === 'stamped', global.cancellationStatus) ||
                  global.cancellationStatus === 'pending') && (
                  <CancelForm
                    action={cancelAction}
                    kind="global"
                    id={global.id}
                    status={global.cancellationStatus}
                    defaultMotive={global.overlappingInvoices > 0 ? '04' : '02'}
                  />
                )}
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
