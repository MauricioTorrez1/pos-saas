import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { DEFAULT_APPEARANCE, type Appearance } from '../shared/appearance';
import type { UserSummary } from '../shared/auth';
import type { AuthState, PosApi } from '../shared/pos-api';
import { applyAppearance } from './appearance/apply-appearance';
import { AppearanceDialog } from './appearance/AppearanceDialog';
import { LoginScreen } from './auth/LoginScreen';
import { PendingSaleDialog } from './recovery/PendingSaleDialog';
import { usePendingSales } from './recovery/use-pending-sales';
import { SaleScreen } from './sale/SaleScreen';

type AppInfoState = { status: 'loading' } | { status: 'ready'; version: string } | { status: 'failed' };

const UNNAMED_REGISTER = 'Caja';

const SHORTCUTS: readonly { readonly keys: string; readonly action: string }[] = [
  { keys: 'Enter', action: 'Agregar' },
  { keys: '↑ ↓', action: 'Moverse' },
  { keys: '+ −', action: 'Cantidad' },
  { keys: 'Supr', action: 'Quitar' },
  { keys: 'Esc', action: 'Limpiar' },
  { keys: 'F12', action: 'Cobrar' },
  { keys: 'F8', action: 'Reimprimir' },
  { keys: 'F6', action: 'Salir' },
];

interface AppProps {
  readonly posApi: PosApi;
}

/**
 * The register. It receives the bridge as a prop, so it never touches what lies behind it. It shows the sign-in until a
 * person enters, and the register screen after that.
 *
 * @param props.posApi bridge to the main process
 * @returns the screen
 */
export function App({ posApi }: AppProps): ReactElement {
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [authState, setAuthState] = useState<AuthState | null>(null);
  const [authFailed, setAuthFailed] = useState(false);

  useEffect(() => {
    posApi.getAppearance().then(setAppearance, (error: unknown) => {
      // Selling matters more than colors, so the register goes on with the default look.
      console.error('Could not read the appearance', error);
    });
  }, [posApi]);

  useEffect(() => applyAppearance(appearance), [appearance]);

  const loadAuthState = useCallback(() => {
    posApi.getAuthState().then(setAuthState, () => setAuthFailed(true));
  }, [posApi]);

  useEffect(loadAuthState, [loadAuthState]);

  const signOut = useCallback(() => {
    posApi.logout().then(loadAuthState, loadAuthState);
  }, [posApi, loadAuthState]);

  if (authFailed) {
    return (
      <p className="notice" role="alert">
        No se pudo abrir la caja. Reiníciala y, si sigue igual, avísale a soporte.
      </p>
    );
  }
  if (authState === null) {
    return <div className="register" aria-busy="true" />;
  }
  if (authState.current === null) {
    return <LoginScreen posApi={posApi} authState={authState} onSignedIn={loadAuthState} />;
  }
  return (
    <RegisterScreen posApi={posApi} user={authState.current} appearance={appearance} onAppearanceSaved={setAppearance} onSignOut={signOut} />
  );
}

interface RegisterScreenProps {
  readonly posApi: PosApi;
  readonly user: UserSummary;
  readonly appearance: Appearance;
  readonly onAppearanceSaved: (appearance: Appearance) => void;
  readonly onSignOut: () => void;
}

function RegisterScreen({ posApi, user, appearance, onAppearanceSaved, onSignOut }: RegisterScreenProps): ReactElement {
  const [appInfo, setAppInfo] = useState<AppInfoState>({ status: 'loading' });
  const [isEditingAppearance, setIsEditingAppearance] = useState(false);
  const pendingSales = usePendingSales(posApi);
  const hasPendingSales = pendingSales.sales.length > 0;
  const isOwner = user.role === 'owner';

  useEffect(() => {
    posApi.getAppInfo().then(
      ({ version }) => setAppInfo({ status: 'ready', version }),
      () => setAppInfo({ status: 'failed' }),
    );
  }, [posApi]);

  // Only the owner changes how the register looks, and the main process refuses anyone else.
  const openAppearance = useCallback(() => setIsEditingAppearance(isOwner), [isOwner]);
  const closeAppearance = useCallback(() => setIsEditingAppearance(false), []);

  const saveAppearance = async (updated: Appearance): Promise<void> => {
    await posApi.saveAppearance(updated);
    onAppearanceSaved(updated);
    setIsEditingAppearance(false);
  };

  return (
    <div className="register">
      <header className="register-header">
        <h1>{appearance.businessName || UNNAMED_REGISTER}</h1>
        <p className="register-user" aria-label="Persona en la caja">
          {user.name}
        </p>
        {/* Out of the tab order: the keys are the keyboard route, and Tab must not pull a scan out of the lookup box. */}
        {isOwner && (
          <button type="button" className="header-button" tabIndex={-1} onClick={openAppearance}>
            Apariencia <kbd>F9</kbd>
          </button>
        )}
        <button type="button" className="header-button" tabIndex={-1} onClick={onSignOut}>
          Salir <kbd>F6</kbd>
        </button>
      </header>
      <SaleScreen
        posApi={posApi}
        isKeyboardElsewhere={isEditingAppearance || hasPendingSales}
        onOpenAppearance={openAppearance}
        onSignOut={onSignOut}
      />
      <footer className="register-footer">
        <ul className="shortcuts" aria-label="Atajos de teclado">
          {SHORTCUTS.map(({ keys, action }) => (
            <li key={action}>
              <kbd>{keys}</kbd> {action}
            </li>
          ))}
        </ul>
        {appInfo.status === 'ready' && <p className="version">Versión {appInfo.version}</p>}
        {appInfo.status === 'failed' && (
          <p className="version" role="alert">
            No se pudo leer la versión de la caja.
          </p>
        )}
        {pendingSales.couldNotRead && (
          <p className="version" role="alert">
            No se pudieron revisar las ventas pendientes. Reinicia la caja.
          </p>
        )}
      </footer>
      {isEditingAppearance && !hasPendingSales && (
        <AppearanceDialog saved={appearance} onPreview={applyAppearance} onSave={saveAppearance} onClose={closeAppearance} />
      )}
      {hasPendingSales && <PendingSaleDialog sales={pendingSales.sales} onAnswer={pendingSales.answer} />}
    </div>
  );
}
