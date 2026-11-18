import type { Metadata } from 'next';
import { ImportPanel } from '@/components/catalog/import-panel';
import { importCatalogAction } from '../actions';

export const metadata: Metadata = { title: 'Importar catálogo' };
export const dynamic = 'force-dynamic';

/** Loads products from a CSV file (RF-005) with `POST /imports/catalog`: check first, then load. */
export default function ImportPage() {
  return (
    <>
      <div className="shell__heading">
        <h1>Importar catálogo</h1>
        <p>Primero revisamos el archivo sin guardar nada; tú decides si se carga.</p>
      </div>
      <ImportPanel action={importCatalogAction} />
    </>
  );
}
