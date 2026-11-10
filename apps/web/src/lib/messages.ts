/** Notice shown on the home page after a failed or interrupted sign-in. */
export interface HomeNotice {
  text: string;
  severity: 'warn' | 'danger';
}

const NOTICES: Record<string, HomeNotice> = {
  login_required: { text: 'Inicia sesión para entrar al panel.', severity: 'warn' },
  session_expired: { text: 'Tu sesión terminó. Inicia sesión de nuevo para seguir.', severity: 'warn' },
  login_cancelled: { text: 'No se inició la sesión. Puedes intentarlo otra vez.', severity: 'warn' },
  login_expired: { text: 'El intento de inicio de sesión tardó demasiado. Inténtalo de nuevo.', severity: 'warn' },
  login_failed: { text: 'No pudimos iniciar tu sesión. Inténtalo de nuevo.', severity: 'danger' },
  idp_unavailable: {
    text: 'El servicio de inicio de sesión no responde. Inténtalo en unos minutos.',
    severity: 'danger',
  },
};

/**
 * Translates the `error` query parameter of the home page into a notice.
 *
 * Unknown values give no notice, so the URL can never put text of its own on the screen.
 */
export function noticeFor(code: string | undefined): HomeNotice | null {
  return (code && NOTICES[code]) || null;
}
