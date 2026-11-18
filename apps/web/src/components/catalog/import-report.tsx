import type { ImportReport } from '@/lib/catalog/types';

interface ImportReportViewProps {
  report: ImportReport;
}

/** Rows of the report shown on screen; the download carries all of them. */
const ROWS_SHOWN = 200;

/** What a check or a load of a CSV file found: what is new, what was already there and what cannot be loaded. */
export function ImportReportView({ report }: ImportReportViewProps) {
  const verb = report.dryRun ? 'Se cargarían' : 'Se cargaron';
  return (
    <section className="panel stack" aria-labelledby="import-report-title" data-testid="import-report">
      <h2 id="import-report-title">{report.dryRun ? 'Revisión del archivo' : 'Archivo cargado'}</h2>
      <dl className="figures">
        <div>
          <dt>Filas leídas</dt>
          <dd>{report.rowsRead}</dd>
        </div>
        <div>
          <dt>{verb}</dt>
          <dd data-testid="import-created">{report.created}</dd>
        </div>
        <div>
          <dt>Ya existían</dt>
          <dd>{report.alreadyThere}</dd>
        </div>
        <div>
          <dt>Con errores</dt>
          <dd data-testid="import-invalid">{report.invalid.length}</dd>
        </div>
      </dl>
      {report.alreadyThere > 0 && (
        <p className="panel__detail">
          Las filas cuyo código ya es de un producto se dejan como están: la importación no cambia precios. Para eso usa
          «Cambiar precios».
        </p>
      )}
      {report.pricesSkipped > 0 && (
        <p className="notice">
          {report.pricesSkipped} {report.pricesSkipped === 1 ? 'producto queda' : 'productos quedan'} sin precio porque
          solo el dueño pone precios. El dueño puede ponerlos después.
        </p>
      )}
      {report.ignoredColumns.length > 0 && (
        <p className="panel__detail">No se guardan estas columnas: {report.ignoredColumns.join(', ')}.</p>
      )}
      {report.invalid.length > 0 && (
        <div className="table-wrap table-wrap--short">
          <table className="table">
            <thead>
              <tr>
                <th scope="col" className="table__number">
                  Fila
                </th>
                <th scope="col">Por qué no se carga</th>
              </tr>
            </thead>
            <tbody>
              {report.invalid.slice(0, ROWS_SHOWN).map((row) => (
                <tr key={`${row.line}-${row.reason}`}>
                  <td className="table__number">{row.line}</td>
                  <td>{row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {report.invalid.length > ROWS_SHOWN && (
        <p className="panel__detail">
          Se muestran las primeras {ROWS_SHOWN} de {report.invalid.length}. Descarga la lista para verlas todas.
        </p>
      )}
    </section>
  );
}
