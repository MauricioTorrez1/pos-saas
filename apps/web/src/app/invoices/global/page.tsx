import type { Metadata } from 'next';
import { GlobalInvoiceList } from '@/components/invoicing/global-invoice-list';
import { GlobalInvoicePanel } from '@/components/invoicing/global-invoice-panel';
import { defaultGlobalDay, globalFailureMessage } from '@/lib/invoicing/messages';
import { getInvoicingApi } from '@/lib/server';
import { globalInvoiceAction } from '../actions';

export const metadata: Metadata = { title: 'Factura global' };
export const dynamic = 'force-dynamic';

/** The global invoice of the sales nobody asked to invoice (RF-036). The proxy and the core require `invoice.issue`. */
export default async function GlobalInvoicePage() {
  const api = await getInvoicingApi();
  const globals = await api.listGlobals();
  return (
    <>
      <div className="shell__heading">
        <h1>Factura global</h1>
        <p>
          Las ventas que nadie pidió facturar van en una factura a «Público en general» (RFC XAXX010101000). Revisa el
          periodo antes de timbrar: nada se timbra hasta que confirmas.
        </p>
      </div>
      <GlobalInvoicePanel action={globalInvoiceAction} defaultDay={defaultGlobalDay(new Date())} />
      <section className="panel stack" aria-labelledby="globals-title">
        <h2 id="globals-title">Facturas globales recientes</h2>
        {globals.ok ? (
          <GlobalInvoiceList globals={globals.data} />
        ) : (
          <p className="notice notice--danger">{globalFailureMessage(globals)}</p>
        )}
      </section>
    </>
  );
}
