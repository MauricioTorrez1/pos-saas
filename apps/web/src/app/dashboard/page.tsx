import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Brand } from '@/components/brand';
import { CoreStatus } from '@/components/core-status';
import { RoleList } from '@/components/role-list';
import { fetchMe } from '@/lib/core-client';
import { shortTenantId } from '@/lib/format';
import { getConfig, getSession } from '@/lib/server';

export const metadata: Metadata = { title: 'Inicio' };
export const dynamic = 'force-dynamic';

/**
 * Protected page. The proxy already checked the session; this page shows the business of the token and the role that the core returns in `GET /me`, and proves the chain by calling `GET /me` on the core with the access token. That call
 * happens here, on the server, so the token never reaches the browser.
 */
export default async function DashboardPage() {
  const session = await getSession();
  if (!session) {
    redirect('/?error=login_required');
  }
  const me = await fetchMe(getConfig(), session.accessToken);

  return (
    <>
      <header className="shell__bar">
        <Brand />
        <form method="post" action="/auth/logout">
          <button type="submit" className="button button--quiet">
            Cerrar sesión
          </button>
        </form>
      </header>
      <main className="shell__main">
        <div className="shell__heading">
          <h1>Hola, bienvenido</h1>
          <p>Esto es lo que el sistema sabe de tu sesión.</p>
        </div>
        <div className="grid">
          <section className="panel" aria-labelledby="tenant-label">
            <h2 id="tenant-label" className="panel__label">
              Tu negocio
            </h2>
            {session.tenantId ? (
              <>
                <p className="panel__value mono" title={session.tenantId} data-testid="tenant">
                  {shortTenantId(session.tenantId)}
                </p>
                <p className="panel__detail">Identificador de tu negocio.</p>
              </>
            ) : (
              <>
                <p className="panel__value">Sin negocio</p>
                <p className="panel__detail">Tu usuario aún no tiene un negocio asignado.</p>
              </>
            )}
          </section>
          <section className="panel" aria-labelledby="role-label">
            <h2 id="role-label" className="panel__label">
              Tu rol
            </h2>
            <RoleList role={me.status === 'ok' ? me.role : null} known={me.status === 'ok' || me.status === 'forbidden'} />
          </section>
          <section className="panel" aria-labelledby="core-label">
            <h2 id="core-label" className="panel__label">
              Sistema central
            </h2>
            <CoreStatus result={me} />
          </section>
        </div>
      </main>
    </>
  );
}
