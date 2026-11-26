import { cancellationLabel, formatCents, mayAskToCancel } from '@/lib/invoicing/messages';
import type { CfdiActionState, CreditNoteView, InvoiceRow } from '@/lib/invoicing/types';
import { CancelForm, CreditNoteButton, ReplaceForm } from './cfdi-forms';

type CfdiAction = (previous: CfdiActionState, data: FormData) => Promise<CfdiActionState>;

interface InvoiceListProps {
  invoices: InvoiceRow[];
  /** Only the owner holds `invoice.cancel`; for anyone else the list shows no cancel or replace forms. */
  mayCancel: boolean;
  cancelAction: CfdiAction;
  replaceAction: CfdiAction;
}

const STATUS_LABELS: Record<InvoiceRow['status'], string> = {
  stamped: 'Timbrada',
  pending: 'En proceso',
  failed: 'Rechazada',
};

/**
 * The latest individual invoices with their cancellation (ADR 0082). A replacement shows which invoice it replaces,
 * and the original offers its UUID as the substitute of motive 01.
 */
export function InvoiceList({ invoices, mayCancel, cancelAction, replaceAction }: InvoiceListProps) {
  if (invoices.length === 0) {
    return <p>Todavía no hay facturas.</p>;
  }
  const replacementOf = new Map(
    invoices.filter((row) => row.replacesInvoiceId && row.status === 'stamped').map((row) => [row.replacesInvoiceId!, row]),
  );
  return (
    <table className="table" aria-label="Facturas">
      <thead>
        <tr>
          <th scope="col">Folio</th>
          <th scope="col">RFC</th>
          <th scope="col">Total</th>
          <th scope="col">Estado</th>
          <th scope="col">UUID</th>
          {mayCancel && <th scope="col">Acciones</th>}
        </tr>
      </thead>
      <tbody>
        {invoices.map((row) => {
          const replacement = replacementOf.get(row.id);
          const stamped = row.status === 'stamped' && !row.superseded;
          return (
            <tr key={row.id}>
              <td>{row.folio}</td>
              <td className="mono">{row.receiverTaxId}</td>
              <td>{row.totalCents === null ? '—' : formatCents(row.totalCents)}</td>
              <td>
                {STATUS_LABELS[row.status]} · {cancellationLabel(row.cancellationStatus)}
                {row.cancellationMotive && ` (motivo ${row.cancellationMotive})`}
                {row.replacesInvoiceId && ' · Sustituye a otra factura'}
                {replacement && !row.superseded && ' · Ya tiene sustituta: cancélala con motivo 01'}
              </td>
              <td className="mono">{row.fiscalUuid ?? '—'}</td>
              {mayCancel && (
                <td>
                  {mayAskToCancel(stamped, row.cancellationStatus) || row.cancellationStatus === 'pending' ? (
                    <CancelForm
                      action={cancelAction}
                      kind="invoice"
                      id={row.id}
                      status={row.cancellationStatus}
                      substituteFiscalUuid={replacement?.fiscalUuid ?? null}
                    />
                  ) : null}
                  {stamped && !replacement && !row.cancellationStatus && (
                    <ReplaceForm action={replaceAction} saleId={row.saleId} invoiceId={row.id} />
                  )}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

interface CreditNoteListsProps {
  candidates: CreditNoteView[];
  recent: CreditNoteView[];
  issueAction: CfdiAction;
}

const TARGET_LABELS: Record<CreditNoteView['target'], string> = {
  invoice: 'su factura',
  global_invoice: 'la factura global',
};

/**
 * Returns of invoiced sales waiting for their credit note, and the credit notes already issued. A return that arrived
 * before its global was stamped is not here: the global already left it out.
 */
export function CreditNoteLists({ candidates, recent, issueAction }: CreditNoteListsProps) {
  return (
    <div className="stack">
      <h3>Devoluciones sin nota de crédito</h3>
      {candidates.length === 0 ? (
        <p>No hay devoluciones de ventas facturadas pendientes.</p>
      ) : (
        <ul className="stack">
          {candidates.map((candidate) => (
            <li key={candidate.returnId}>
              Folio {candidate.folio} · {formatCents(candidate.refundCents)} · corrige {TARGET_LABELS[candidate.target]}
              <CreditNoteButton
                action={issueAction}
                returnId={candidate.returnId}
                label={`Emitir nota de crédito del folio ${candidate.folio}`}
              />
            </li>
          ))}
        </ul>
      )}
      <h3>Notas de crédito recientes</h3>
      {recent.length === 0 ? (
        <p>Todavía no hay notas de crédito.</p>
      ) : (
        <table className="table" aria-label="Notas de crédito">
          <thead>
            <tr>
              <th scope="col">Folio</th>
              <th scope="col">Importe</th>
              <th scope="col">Corrige</th>
              <th scope="col">Estado</th>
              <th scope="col">UUID</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((note) => (
              <tr key={note.creditNoteId}>
                <td>{note.folio}</td>
                <td>{formatCents(note.refundCents)}</td>
                <td>{TARGET_LABELS[note.target]}</td>
                <td>
                  {note.status === 'stamped' ? 'Timbrada' : note.status === 'failed' ? 'Rechazada' : 'En proceso'}
                  {note.status === 'pending' && note.errorCode && ' (Facturapi no respondió; vuelve a emitirla)'}
                </td>
                <td className="mono">{note.fiscalUuid ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
