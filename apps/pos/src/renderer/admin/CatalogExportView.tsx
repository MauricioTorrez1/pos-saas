import { useState, type ReactElement } from 'react';

import { CATALOG_FORMAT_LABELS, type CatalogExportApi, type CatalogExportFormat, type CatalogExportResult } from '../../shared/catalog-export';
import { CheckField, Message, useAction } from '../ui/form-parts';
import { useWindowKeys } from '../ui/use-window-keys';

interface CatalogExportViewProps {
  readonly catalogExportApi: CatalogExportApi;
  readonly onBack: () => void;
}

/** What the person reads after an export that did not save a file. */
function refusalMessage(result: Exclude<CatalogExportResult, { status: 'saved' } | { status: 'cancelled' }>): string {
  switch (result.status) {
    case 'authorization_required':
      return 'Solo el dueño puede exportar el catálogo.';
    case 'wrong_pin':
      return `PIN incorrecto. Quedan ${result.attemptsLeft} intento(s).`;
    case 'locked':
      return 'Demasiados intentos. Espera unos minutos.';
    case 'failed':
      return result.message;
  }
}

/**
 * Saves the whole catalog as a PDF, an Excel workbook or a CSV: one row per product with its codes, suppliers, cost,
 * price, stock and margins. "Solo activos" starts on, so the products that were given up are left out unless the owner
 * asks for them. Everything is from the keyboard.
 *
 * @param props.catalogExportApi bridge to the main process
 * @param props.onBack called to go back to the administration summary
 * @returns the view
 */
export function CatalogExportView({ catalogExportApi, onBack }: CatalogExportViewProps): ReactElement {
  const [activeOnly, setActiveOnly] = useState(true);
  const [saved, setSaved] = useState<string | null>(null);
  const { isBusy, message, setMessage, run } = useAction();

  const exportAs = (format: CatalogExportFormat): void =>
    run(async () => {
      setSaved(null);
      const result = await catalogExportApi.exportCatalog({ format, activeOnly });
      if (result.status === 'saved') {
        setSaved(`Listo: ${result.productCount} producto(s) en ${CATALOG_FORMAT_LABELS[format]}, guardado en ${result.path}`);
      } else if (result.status !== 'cancelled') {
        setMessage(refusalMessage(result));
      }
    });

  useWindowKeys(
    {
      F2: () => exportAs('pdf'),
      F3: () => exportAs('xlsx'),
      F4: () => exportAs('csv'),
      F5: () => setActiveOnly((value) => !value),
      Escape: onBack,
    },
    isBusy,
  );

  return (
    <>
      <h2 id="admin-title">Exportar catálogo</h2>
      <p>Un renglón por producto: códigos, nombre, unidad, proveedores con su código, costo sin y con IVA, precio con IVA, existencia, margen bruto y margen neto. Al final van los totales y una leyenda que explica cada margen.</p>
      <CheckField label="Solo activos (F5)" checked={activeOnly} onChange={setActiveOnly} />
      {isBusy && (
        <p className="notice notice-info" role="status">
          Exportando el catálogo… Con muchos productos puede tardar unos segundos.
        </p>
      )}
      {saved !== null && !isBusy && (
        <p className="notice notice-info" role="status">
          {saved}
        </p>
      )}
      <Message text={message} />
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} disabled={isBusy} onClick={onBack}>
          Volver <kbd>Esc</kbd>
        </button>
        <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={() => exportAs('pdf')}>
          PDF <kbd>F2</kbd>
        </button>
        <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={() => exportAs('xlsx')}>
          Excel <kbd>F3</kbd>
        </button>
        <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={() => exportAs('csv')}>
          CSV <kbd>F4</kbd>
        </button>
      </div>
    </>
  );
}
