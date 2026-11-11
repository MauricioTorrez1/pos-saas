import { redirect } from 'next/navigation';
import { Brand } from '@/components/brand';
import { noticeFor } from '@/lib/messages';
import { getSession } from '@/lib/server';

interface HomeProps {
  searchParams: Promise<{ error?: string | string[] }>;
}

/** Home page: explains what the panel is for and offers the sign-in. A signed-in user goes straight to the dashboard. */
export default async function HomePage({ searchParams }: HomeProps) {
  if (await getSession()) {
    redirect('/dashboard');
  }
  const { error } = await searchParams;
  const notice = noticeFor(Array.isArray(error) ? error[0] : error);

  return (
    <main className="home">
      <section className="home__card" aria-labelledby="home-title">
        <Brand />
        <h1 id="home-title" className="home__title">
          Tu tienda, a la vista
        </h1>
        <p className="home__lead">
          Entra para ver tu negocio, tu catálogo y todo lo que pasa en la caja, desde cualquier navegador.
        </p>
        <a className="button" href="/auth/login">
          Iniciar sesión
        </a>
        <p className="home__hint">Usarás tu cuenta del negocio. Nadie más que tú ve tus datos.</p>
        {notice && (
          <p className={notice.severity === 'danger' ? 'notice notice--danger' : 'notice'} role="alert">
            {notice.text}
          </p>
        )}
      </section>
    </main>
  );
}
