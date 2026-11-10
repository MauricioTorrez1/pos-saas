import type { Metadata } from 'next';
import { Brand } from '@/components/brand';

export const metadata: Metadata = { title: 'Sin permiso' };

/** Shown, through a rewrite of the proxy, when the role of the user does not allow the route. */
export default function ForbiddenPage() {
  return (
    <main className="home">
      <section className="home__card" aria-labelledby="forbidden-title">
        <Brand />
        <h1 id="forbidden-title" className="home__title">
          No tienes permiso para ver esto
        </h1>
        <p className="home__lead">Tu rol no incluye esta sección. Si la necesitas, pídele al dueño que te la habilite.</p>
        <a className="button" href="/dashboard">
          Volver al inicio
        </a>
      </section>
    </main>
  );
}
