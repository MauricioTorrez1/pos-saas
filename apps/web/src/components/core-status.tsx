import type { MeResult } from '@/lib/core-client';

interface CoreStatusProps {
  result: MeResult;
}

const SIGN_IN_AGAIN = (
  <a className="button button--quiet" href="/auth/login">
    Iniciar sesión de nuevo
  </a>
);

/** Shows whether the core accepted the session, and what to do when it did not. */
export function CoreStatus({ result }: CoreStatusProps) {
  switch (result.status) {
    case 'ok':
      return (
        <div className="stack">
          <span className="pill pill--ok">Conectado</span>
          <p className="panel__detail">El sistema central reconoce tu sesión y tu negocio.</p>
        </div>
      );
    case 'unauthorized':
      return (
        <div className="stack">
          <span className="pill pill--warn">Sesión no válida</span>
          <p className="panel__detail">El sistema central ya no acepta tu sesión.</p>
          {SIGN_IN_AGAIN}
        </div>
      );
    case 'forbidden':
      return (
        <div className="stack">
          <span className="pill pill--danger">Sin negocio asignado</span>
          <p className="panel__detail">Tu usuario todavía no pertenece a un negocio. Pídele a quien te dio de alta que lo asigne.</p>
        </div>
      );
    case 'unavailable':
      return (
        <div className="stack">
          <span className="pill pill--warn">Sin conexión</span>
          <p className="panel__detail">No pudimos hablar con el sistema central. Tu sesión sigue abierta; recarga en unos minutos.</p>
        </div>
      );
  }
}
