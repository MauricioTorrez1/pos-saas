import type { Metadata } from 'next';
import { PriceChangePanel } from '@/components/catalog/price-change-panel';
import { priceChangeAction } from '../actions';

export const metadata: Metadata = { title: 'Cambiar precios' };
export const dynamic = 'force-dynamic';

/** Bulk price change (RF-006), owner only: the proxy and the core both require `price.change`. */
export default function PriceChangesPage() {
  return (
    <>
      <div className="shell__heading">
        <h1>Cambiar precios en bloque</h1>
        <p>Sube o baja por porcentaje los precios de una marca o de una familia. Nada cambia hasta que confirmas.</p>
      </div>
      <PriceChangePanel action={priceChangeAction} />
    </>
  );
}
