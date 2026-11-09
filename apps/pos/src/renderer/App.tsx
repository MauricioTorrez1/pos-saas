import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { DEFAULT_APPEARANCE, type Appearance } from '../shared/appearance';
import type { PosApi } from '../shared/pos-api';
import { applyAppearance } from './appearance/apply-appearance';
import { AppearanceDialog } from './appearance/AppearanceDialog';
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
];

interface AppProps {
  readonly posApi: PosApi;
}

/**
 * Register screen. It receives the bridge as a prop, so it never touches what lies behind it.
 *
 * @param props.posApi bridge to the main process
 * @returns the screen
 */
export function App({ posApi }: AppProps): ReactElement {
  const [appInfo, setAppInfo] = useState<AppInfoState>({ status: 'loading' });
  const [appearance, setAppearance] = useState<Appearance>(DEFAULT_APPEARANCE);
  const [isEditingAppearance, setIsEditingAppearance] = useState(false);
  const pendingSales = usePendingSales(posApi);
  const hasPendingSales = pendingSales.sales.length > 0;

  useEffect(() => {
    posApi.getAppInfo().then(
      ({ version }) => setAppInfo({ status: 'ready', version }),
      () => setAppInfo({ status: 'failed' }),
    );
  }, [posApi]);

  useEffect(() => {
    posApi.getAppearance().then(setAppearance, (error: unknown) => {
      // Selling matters more than colors, so the register goes on with the default look.
      console.error('Could not read the appearance', error);
    });
  }, [posApi]);

  useEffect(() => applyAppearance(appearance), [appearance]);

  const openAppearance = useCallback(() => setIsEditingAppearance(true), []);
  const closeAppearance = useCallback(() => setIsEditingAppearance(false), []);

  const saveAppearance = async (updated: Appearance): Promise<void> => {
    await posApi.saveAppearance(updated);
    setAppearance(updated);
    setIsEditingAppearance(false);
  };

  return (
    <div className="register">
      <header className="register-header">
        <h1>{appearance.businessName || UNNAMED_REGISTER}</h1>
        {/* Out of the tab order: F9 is the keyboard route, and Tab must not pull a scan out of the lookup box. */}
        <button type="button" className="header-button" tabIndex={-1} onClick={openAppearance}>
          Apariencia <kbd>F9</kbd>
        </button>
      </header>
      <SaleScreen posApi={posApi} isKeyboardElsewhere={isEditingAppearance || hasPendingSales} onOpenAppearance={openAppearance} />
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
