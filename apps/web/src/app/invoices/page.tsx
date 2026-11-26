import type { Metadata } from 'next';
import { CreditNoteLists, InvoiceList } from '@/components/invoicing/invoice-list';
import { cfdiFailureMessage } from '@/lib/invoicing/messages';
import { getInvoicingApi, getMe } from '@/lib/server';
import { cancellationAction, creditNoteAction, replaceInvoiceAction } from './cfdi-actions';

export const metadata: Metadata = { title: 'Facturas' };
export const dynamic = 'force-dynamic';

/**
 * Individual invoices, their cancellation and the credit notes of returns (RF-037, RF-038, ADR 0081). The proxy lets
 * in the owner and the manager; only the owner sees the cancel and replace forms, and the core checks it again.
 */
export default async function InvoicesPage() {
  const [api, me] = await Promise.all([getInvoicingApi(), getMe()]);
  const [invoices, candidates, recent] = await Promise.all([
    api.listInvoices(),
    api.creditNoteCandidates(),
    api.recentCreditNotes(),
  ]);
  const isOwner = me.status === 'ok' && me.role === 'owner';
  const creditFailure = !candidates.ok ? candidates : !recent.ok ? recent : null;
  return (
    <>
      <div className="shell__heading">
        <h1>Facturas</h1>
        <p>
          Cancelar una factura la deja en el historial: nada se borra. Si el cliente debe aceptarla, queda en espera
          hasta que responda o pasen 72 horas; usa «Consultar cancelación» para ver si ya respondió.
        </p>
      </div>
      <section className="panel stack" aria-labelledby="invoices-title">
        <h2 id="invoices-title">Facturas recientes</h2>
        {invoices.ok ? (
          <InvoiceList
            invoices={invoices.data}
            mayCancel={isOwner}
            cancelAction={cancellationAction}
            replaceAction={replaceInvoiceAction}
          />
        ) : (
          <p className="notice notice--danger">{cfdiFailureMessage(invoices)}</p>
        )}
      </section>
      <section className="panel stack" aria-labelledby="credit-notes-title">
        <h2 id="credit-notes-title">Notas de crédito</h2>
        {creditFailure ? (
          <p className="notice notice--danger">{cfdiFailureMessage(creditFailure)}</p>
        ) : (
          <CreditNoteLists
            candidates={candidates.ok ? candidates.data : []}
            recent={recent.ok ? recent.data : []}
            issueAction={creditNoteAction}
          />
        )}
      </section>
    </>
  );
}
