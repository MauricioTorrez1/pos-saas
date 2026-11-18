import Link from 'next/link';

interface PaginationProps {
  /** Current page, from 0. */
  page: number;
  pageSize: number;
  total: number;
  /** The search, kept in the links. */
  query: string;
}

function hrefFor(query: string, page: number): string {
  const params = new URLSearchParams();
  if (query) {
    params.set('q', query);
  }
  if (page > 0) {
    params.set('page', String(page + 1));
  }
  const search = params.toString();
  return search ? `/catalog?${search}` : '/catalog';
}

/**
 * Previous and next links of the product list. The page lives in the URL (`?page=3`), so the back button and a
 * shared link land on the same page. The URL counts from 1 for people; the core counts from 0.
 */
export function Pagination({ page, pageSize, total, query }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const first = total === 0 ? 0 : page * pageSize + 1;
  const last = Math.min(total, (page + 1) * pageSize);
  return (
    <nav className="pagination" aria-label="Páginas del catálogo">
      <p className="pagination__summary" data-testid="page-summary">
        {total === 0 ? 'Sin productos' : `${first}–${last} de ${total.toLocaleString('es-MX')} productos`}
      </p>
      <div className="pagination__links">
        {page > 0 ? (
          <Link className="button button--quiet" href={hrefFor(query, page - 1)} rel="prev">
            Anterior
          </Link>
        ) : (
          <span className="button button--quiet button--disabled" aria-disabled="true">
            Anterior
          </span>
        )}
        <span className="pagination__page">
          Página {Math.min(page + 1, pages)} de {pages}
        </span>
        {page + 1 < pages ? (
          <Link className="button button--quiet" href={hrefFor(query, page + 1)} rel="next">
            Siguiente
          </Link>
        ) : (
          <span className="button button--quiet button--disabled" aria-disabled="true">
            Siguiente
          </span>
        )}
      </div>
    </nav>
  );
}
