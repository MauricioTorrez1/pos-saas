import type { Metadata } from 'next';
import Link from 'next/link';
import { Pagination } from '@/components/catalog/pagination';
import { ProductTable } from '@/components/catalog/product-table';
import { failureMessage, PAGE_SIZE } from '@/lib/catalog/core-api';
import { getCoreApi } from '@/lib/server';

export const metadata: Metadata = { title: 'Catálogo' };
export const dynamic = 'force-dynamic';

interface CatalogPageProps {
  searchParams: Promise<{ q?: string | string[]; page?: string | string[]; deleted?: string }>;
}

/** Reads the page of the URL (from 1, for people) into the page of the core (from 0). */
function pageIndex(raw: string | string[] | undefined): number {
  const value = Number.parseInt(Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? ''), 10);
  return Number.isFinite(value) && value > 1 ? value - 1 : 0;
}

/**
 * The product list. The search and the page live in the URL and the core does the searching, by name (any case,
 * any accent) or by exact code, and returns one page of {@link PAGE_SIZE}. The browser never holds the whole catalog.
 */
export default async function CatalogPage({ searchParams }: CatalogPageProps) {
  const params = await searchParams;
  const query = (Array.isArray(params.q) ? params.q[0] : params.q)?.trim() ?? '';
  const page = pageIndex(params.page);
  const api = await getCoreApi();
  const result = await api.listProducts(query, page);

  return (
    <>
      <div className="shell__heading shell__heading--split">
        <div>
          <h1>Productos</h1>
          <p>Busca por nombre o escanea un código. Abre un producto para editarlo.</p>
        </div>
        <Link className="button" href="/catalog/new">
          Nuevo producto
        </Link>
      </div>

      {params.deleted && (
        <p className="notice notice--ok" role="status">
          Producto dado de baja.
        </p>
      )}

      <form className="search" role="search" action="/catalog">
        <label htmlFor="q" className="visually-hidden">
          Buscar productos
        </label>
        <input id="q" name="q" type="search" defaultValue={query} placeholder="Nombre o código" autoFocus />
        <button type="submit" className="button">
          Buscar
        </button>
        {query && (
          <Link className="button button--quiet" href="/catalog">
            Limpiar
          </Link>
        )}
      </form>

      {!result.ok ? (
        <p className="notice notice--danger" role="alert">
          {failureMessage(result, 'No se pudo cargar el catálogo.')}
        </p>
      ) : result.data.items.length === 0 ? (
        <div className="panel stack">
          <p className="panel__value">{query ? `Nada coincide con «${query}»` : 'Tu catálogo está vacío'}</p>
          <p className="panel__detail">
            {query ? 'Prueba con menos palabras o con el código.' : 'Crea tu primer producto o importa el catálogo de Eleventa.'}
          </p>
          <Link className="button button--quiet" href="/catalog/import">
            Importar desde un archivo
          </Link>
        </div>
      ) : (
        <>
          {query && (
            <p>
              <Link href={`/catalog/labels?q=${encodeURIComponent(query)}`}>Imprimir etiquetas de esta búsqueda</Link>
            </p>
          )}
          <ProductTable products={result.data.items} />
          <Pagination page={result.data.page} pageSize={result.data.size} total={result.data.total} query={query} />
        </>
      )}
    </>
  );
}
