import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { formatLabelPrice, MAX_COPIES, searchCandidates, type CandidateSearch } from '@/lib/labels';
import { getConfig, getSession } from '@/lib/server';
import styles from './labels.module.css';

export const metadata: Metadata = { title: 'Etiquetas' };
export const dynamic = 'force-dynamic';

interface LabelsPageProps {
  searchParams: Promise<{ q?: string | string[]; error?: string | string[] }>;
}

function firstOf(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

/**
 * Shelf labels (F0-22, RF-007): the owner or the manager searches products, picks some or all the matches, and
 * downloads a PDF of labels to print on letter paper. The search runs here, on the server, with the token of the
 * session; the download goes through `/catalog/labels/pdf`.
 */
export default async function LabelsPage({ searchParams }: LabelsPageProps) {
  const session = await getSession();
  if (!session) {
    redirect('/?error=login_required');
  }
  const params = await searchParams;
  const query = firstOf(params.q);
  const error = firstOf(params.error);
  const found: CandidateSearch | null = query ? await searchCandidates(getConfig(), session.accessToken, query) : null;
  if (found?.status === 'unauthorized') {
    redirect('/?error=session_expired');
  }

  return (
    <>
      <div className="shell__heading">
        <h1>Etiquetas de anaquel</h1>
        <p>Busca productos, elige cuáles y descarga un PDF para imprimir en hoja carta: 24 etiquetas por hoja.</p>
      </div>

      <form className={styles.search} method="get" action="/catalog/labels" role="search">
        <label htmlFor="labels-query" className="panel__label">
          Nombre o código
        </label>
        <div className={styles.row}>
          <input
            id="labels-query"
            name="q"
            type="search"
            defaultValue={query}
            placeholder="Ej. martillo, 7501031311309"
            className={styles.input}
            autoFocus
          />
          <button type="submit" className="button">
            Buscar
          </button>
        </div>
      </form>

      {error ? (
        <p className="notice notice--danger" role="alert">
          {error}
        </p>
      ) : null}

      {found === null ? null : found.status !== 'ok' ? (
        <p className="notice notice--danger" role="alert">
          {found.status === 'forbidden'
            ? 'Tu usuario no puede ver productos.'
            : 'El sistema central no responde. Intenta de nuevo en un momento.'}
        </p>
      ) : found.items.length === 0 ? (
        <p className="notice">Ningún producto coincide con «{query}».</p>
      ) : (
        <form method="post" action="/catalog/labels/pdf" className="stack">
          <input type="hidden" name="q" value={query} />
          <p className={styles.count}>
            {found.total > found.items.length
              ? `Se muestran ${found.items.length} de ${found.total} coincidencias.`
              : `${found.total} ${found.total === 1 ? 'coincidencia' : 'coincidencias'}.`}
          </p>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">
                  <span className={styles.hidden}>Elegir</span>
                </th>
                <th scope="col">Producto</th>
                <th scope="col">Código</th>
                <th scope="col" className={styles.price}>
                  Precio con IVA
                </th>
              </tr>
            </thead>
            <tbody>
              {found.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <input
                      type="checkbox"
                      name="productId"
                      value={item.id}
                      id={`label-${item.id}`}
                      defaultChecked
                      aria-label={`Elegir ${item.name}`}
                    />
                  </td>
                  <td>
                    <label htmlFor={`label-${item.id}`}>{item.name}</label>
                  </td>
                  <td className="mono">{item.code ?? '—'}</td>
                  <td className={styles.price}>{formatLabelPrice(item.unitPrice, item.unit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className={styles.row}>
            <label htmlFor="labels-copies">Copias de cada etiqueta</label>
            <input
              id="labels-copies"
              name="copies"
              type="number"
              min={1}
              max={MAX_COPIES}
              defaultValue={1}
              className={styles.copies}
            />
          </div>
          <div className={styles.row}>
            <button type="submit" name="mode" value="chosen" className="button">
              Descargar PDF de los elegidos
            </button>
            <button type="submit" name="mode" value="search" className="button button--quiet">
              Descargar PDF de las {found.total} coincidencias
            </button>
          </div>
        </form>
      )}
    </>
  );
}
