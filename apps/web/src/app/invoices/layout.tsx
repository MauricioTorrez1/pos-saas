import Link from 'next/link';
import type { ReactNode } from 'react';
import { Brand } from '@/components/brand';

/** Frame of the invoicing screens. The proxy already let in only the owner and the manager (`invoice.issue`). */
export default function InvoicesLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <header className="shell__bar">
        <Link href="/dashboard" className="brand-link">
          <Brand />
        </Link>
        <nav className="shell__nav" aria-label="Facturación">
          <Link href="/invoices/global">Factura global</Link>
          <Link href="/catalog">Catálogo</Link>
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
