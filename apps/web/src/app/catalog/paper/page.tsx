import type { Metadata } from 'next';
import { PaperReview } from '@/components/paper-catalog/paper-review';
import { getConfig } from '@/lib/server';

export const metadata: Metadata = { title: 'Catálogo en papel' };
export const dynamic = 'force-dynamic';

/** Reads photographed supplier catalogs with Claude and exports the approved rows for the register (E1-53). */
export default function PaperCatalogPage() {
  return (
    <>
      <div className="shell__heading">
        <h1>Catálogo en papel</h1>
        <p>Fotografía las hojas del proveedor, revisa cada línea y descarga la lista para importarla en la caja.</p>
      </div>
      <PaperReview configured={getConfig().analyticsApiUrl !== null} />
    </>
  );
}
