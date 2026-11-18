import Link from 'next/link';
import type { ReactNode } from 'react';
import { Brand } from '@/components/brand';
import { getMe } from '@/lib/server';

/**
 * Frame of the catalog screens: the top bar and the navigation. The proxy already let in only the owner and the
 * manager; the link to the bulk price change shows only to the owner, who holds `price.change` (ADR 0042).
 */
export default async function CatalogLayout({ children }: { children: ReactNode }) {
  const me = await getMe();
  const isOwner = me.status === 'ok' && me.role === 'owner';
  return (
    <>
      <header className="shell__bar">
        <Link href="/dashboard" className="brand-link">
          <Brand />
        </Link>
        <nav className="shell__nav" aria-label="Catálogo">
          <Link href="/catalog">Productos</Link>
          <Link href="/catalog/new">Nuevo producto</Link>
          <Link href="/catalog/import">Importar</Link>
          <Link href="/catalog/labels">Etiquetas</Link>
          {isOwner && <Link href="/catalog/price-changes">Cambiar precios</Link>}
          {isOwner && <Link href="/catalog/paper">Catálogo en papel</Link>}
        </nav>
        <form method="post" action="/auth/logout">
          <button type="submit" className="button button--quiet">
            Cerrar sesión
          </button>
        </form>
      </header>
      <main className="shell__main shell__main--wide">{children}</main>
    </>
  );
}
