'use client';

import { startTransition, useActionState, useState, type ChangeEvent } from 'react';
import { EMPTY_IMPORT, type ImportState } from '@/lib/catalog/action-state';
import { decodeCsv, rowErrorsCsv } from '@/lib/catalog/csv-file';
import { ImportReportView } from './import-report';

interface ImportPanelProps {
  action: (previous: ImportState, data: FormData) => Promise<ImportState>;
}

interface ChosenFile {
  name: string;
  text: string;
}

/**
 * Loads a CSV file in two steps: check it (`dryRun`), read the report, then load it. The file is read in the
 * browser and kept in memory between the two steps, so the owner does not pick it twice.
 */
export function ImportPanel({ action }: ImportPanelProps) {
  const [state, formAction, pending] = useActionState(action, EMPTY_IMPORT);
  const [file, setFile] = useState<ChosenFile | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    setReadError(null);
    if (!chosen) {
      setFile(null);
      return;
    }
    try {
      const text = decodeCsv(new Uint8Array(await chosen.arrayBuffer()));
      setFile({ name: chosen.name, text });
    } catch {
      setFile(null);
      setReadError('No se pudo leer el archivo. Guárdalo de nuevo como CSV e inténtalo otra vez.');
    }
  }

  function send(mode: 'check' | 'load') {
    if (!file) {
      return;
    }
    const data = new FormData();
    data.set('csv', file.text);
    data.set('mode', mode);
    startTransition(() => formAction(data));
  }

  function downloadErrors() {
    if (!state.report) {
      return;
    }
    const blob = new Blob([rowErrorsCsv(state.report.invalid)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'filas-no-cargadas.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  const report = state.report;
  const canLoad = report?.dryRun === true && report.created > 0;

  return (
    <div className="stack stack--wide">
      <section className="panel stack" aria-labelledby="import-file-title">
        <h2 id="import-file-title">1. Elige el archivo</h2>
        <p className="panel__detail">
          Un CSV con títulos en la primera fila: <strong>Código del producto</strong>, <strong>Nombre del producto</strong>{' '}
          y <strong>Precio de venta</strong>. Opcionales: Unidad, IVA, Clave SAT y Clave unidad SAT. La exportación de
          Eleventa funciona tal cual. Los productos cuyo código ya existe no se tocan.
        </p>
        <a className="table__link" href="/plantilla-catalogo.csv" download>
          Descargar plantilla de ejemplo
        </a>
        <label className="file-picker">
          <span className="button button--quiet">Elegir archivo CSV</span>
          <input type="file" accept=".csv,text/csv" onChange={choose} aria-label="Archivo CSV del catálogo" />
          <span className="file-picker__name" data-testid="chosen-file">
            {file ? file.name : 'Ningún archivo elegido'}
          </span>
        </label>
        {readError && (
          <p className="notice notice--danger" role="alert">
            {readError}
          </p>
        )}
        <div className="form__actions">
          <button type="button" className="button" disabled={!file || pending} onClick={() => send('check')}>
            {pending ? 'Revisando…' : '2. Revisar archivo'}
          </button>
        </div>
      </section>

      {state.error && (
        <p className="notice notice--danger" role="alert">
          {state.error}
        </p>
      )}

      {report && <ImportReportView report={report} />}

      {report && (
        <div className="form__actions">
          {canLoad && (
            <button type="button" className="button" disabled={pending} onClick={() => send('load')}>
              {pending ? 'Cargando…' : `3. Cargar ${report.created} ${report.created === 1 ? 'producto' : 'productos'}`}
            </button>
          )}
          {report.invalid.length > 0 && (
            <button type="button" className="button button--quiet" onClick={downloadErrors}>
              Descargar filas con errores
            </button>
          )}
          {!report.dryRun && (
            <a className="button button--quiet" href="/catalog">
              Ver el catálogo
            </a>
          )}
        </div>
      )}
    </div>
  );
}
