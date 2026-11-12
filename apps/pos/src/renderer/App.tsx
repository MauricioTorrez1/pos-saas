import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { DEFAULT_APPEARANCE, type Appearance } from '../shared/appearance';
import type { UserSummary } from '../shared/auth';
import type { AuthState, PosApi } from '../shared/pos-api';
import type { PricingApi } from '../shared/pricing';
import type { ProductAdminApi } from '../shared/product-admin';
import { applyAppearance } from './appearance/apply-appearance';
import { AppearanceDialog } from './appearance/AppearanceDialog';
import type { CashStatus } from '../shared/cash-api';
import type { DashboardApi } from '../shared/dashboard-api';
import { DashboardDialog } from './dashboard/DashboardDialog';
import { AdminDialog } from './admin/AdminDialog';
import { LoginScreen } from './auth/LoginScreen';
import { CashDialog } from './cash/CashDialog';
import { ReturnDialog } from './returns/ReturnDialog';
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
  { keys: 'F2', action: 'Varios' },
  { keys: 'F3', action: 'Caja' },
  { keys: 'F4', action: 'Devolución' },
  { keys: 'F7', action: 'Precio' },
  { keys: 'F5', action: 'Producto nuevo' },
  { keys: 'F10', action: 'Producto' },
  { keys: 'F11', action: 'Resumen' },
  { keys: 'F8', action: 'Reimprimir' },
  { keys: 'F6', action: 'Salir' },
];

interface AppProps {
  readonly posApi: PosApi;
  /** Changing the price of a product (E1-39). Without it, the register offers no price change. */
  readonly pricingApi?: PricingApi;
  /** Adding products that are not in the catalog (E1-42). Without it, the register offers no product form. */
  readonly productApi?: ProductAdminApi;
  /** The summary of the business (E1-45). Without it, the register offers no summary. */
  readonly dashboardApi?: DashboardApi;
}

/**
 * The register. It receives the bridge as a prop, so it never touches what lies behind it. It shows the sign-in until a
 * person enters, and the register screen after that.
 *
 * @param props.posApi bridge to the main process
 * @param props.pricingApi bridge for changing prices, when the register offers it
 * @param props.productApi bridge for adding products, when the register offers it
 * @param props.dashboardApi bridge for the summary of the business, when the register offers it
 * @returns the screen
 */
export function App({ posApi, pricingApi, productApi, dashboardApi }: AppProps): ReactElement {
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
    <RegisterScreen
      posApi={posApi}
      {...(pricingApi === undefined ? {} : { pricingApi })}
      {...(productApi === undefined ? {} : { productApi })}
      {...(dashboardApi === undefined ? {} : { dashboardApi })}
      user={authState.current}
      appearance={appearance}
      onAppearanceSaved={setAppearance}
      onSignOut={signOut}
    />
  );
}

interface RegisterScreenProps {
  readonly posApi: PosApi;
  readonly pricingApi?: PricingApi;
  readonly productApi?: ProductAdminApi;
  readonly dashboardApi?: DashboardApi;
  readonly user: UserSummary;
  readonly appearance: Appearance;
  readonly onAppearanceSaved: (appearance: Appearance) => void;
  readonly onSignOut: () => void;
}

function RegisterScreen({ posApi, pricingApi, productApi, dashboardApi, user, appearance, onAppearanceSaved, onSignOut }: RegisterScreenProps): ReactElement {
  const [appInfo, setAppInfo] = useState<AppInfoState>({ status: 'loading' });
  const [isEditingAppearance, setIsEditingAppearance] = useState(false);
  const [cash, setCash] = useState<CashStatus | null>(null);
  const [isEditingCash, setIsEditingCash] = useState(false);
  const [isReturning, setIsReturning] = useState(false);
  const [isAdministering, setIsAdministering] = useState(false);
  const [isViewingDashboard, setIsViewingDashboard] = useState(false);
  const pendingSales = usePendingSales(posApi);
  const hasPendingSales = pendingSales.sales.length > 0;
  const isOwner = user.role === 'owner';

  useEffect(() => {
    posApi.getAppInfo().then(
      ({ version }) => setAppInfo({ status: 'ready', version }),
      () => setAppInfo({ status: 'failed' }),
    );
  }, [posApi]);

  const refreshCash = useCallback(() => {
    posApi.getCashStatus().then(setCash, () => setCash(null));
  }, [posApi]);

  // A closed register cannot sell, so the first thing a cashier sees is how to open it. An open register leaves the dialog
  // alone: the cashier may have asked for it (F3) before the first answer came, and that answer must not close it.
  useEffect(() => {
    posApi.getCashStatus().then(
      (status) => {
        setCash(status);
        if (status.session === null) {
          setIsEditingCash(true);
        }
      },
      () => setCash(null),
    );
  }, [posApi]);

  const openCash = useCallback(() => setIsEditingCash(true), []);
  const closeCash = useCallback(() => setIsEditingCash(false), []);
  const openAdmin = useCallback(() => setIsAdministering(isOwner), [isOwner]);
  const closeAdmin = useCallback(() => setIsAdministering(false), []);
  const openDashboard = useCallback(() => setIsViewingDashboard(dashboardApi !== undefined), [dashboardApi]);
  const closeDashboard = useCallback(() => setIsViewingDashboard(false), []);
  // The administration closes when it hands over to the summary, so only one dialog has the keyboard.
  const openDashboardFromAdmin = useCallback(() => {
    setIsAdministering(false);
    openDashboard();
  }, [openDashboard]);
  const openReturns = useCallback(() => setIsReturning(true), []);
  const closeReturns = useCallback(() => setIsReturning(false), []);

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
        <p className="register-cash" data-open={cash?.session !== null && cash !== null} aria-label="Estado de la caja">
          {cash === null ? '' : cash.session === null ? 'Caja cerrada' : 'Caja abierta'}
        </p>
        {/* Out of the tab order: the keys are the keyboard route, and Tab must not pull a scan out of the lookup box. */}
        {isOwner && (
          <button type="button" className="header-button" tabIndex={-1} onClick={openAdmin}>
            Administración <kbd>F1</kbd>
          </button>
        )}
        {isOwner && (
          <button type="button" className="header-button" tabIndex={-1} onClick={openAppearance}>
            Apariencia <kbd>F9</kbd>
          </button>
        )}
        {dashboardApi !== undefined && (
          <button type="button" className="header-button" tabIndex={-1} onClick={openDashboard}>
            Resumen <kbd>F11</kbd>
          </button>
        )}
        <button type="button" className="header-button" tabIndex={-1} onClick={openReturns}>
          Devolución <kbd>F4</kbd>
        </button>
        <button type="button" className="header-button" tabIndex={-1} onClick={openCash}>
          Caja <kbd>F3</kbd>
        </button>
        <button type="button" className="header-button" tabIndex={-1} onClick={onSignOut}>
          Salir <kbd>F6</kbd>
        </button>
      </header>
      {cash?.shouldWithdraw === true && (
        <p className="notice register-banner" role="status">
          Hay mucho efectivo en el cajón. Haz un retiro parcial cuando puedas (F3). Puedes seguir vendiendo.
        </p>
      )}
      <SaleScreen
        posApi={posApi}
        {...(pricingApi === undefined ? {} : { pricingApi })}
        {...(productApi === undefined ? {} : { productApi })}
        isKeyboardElsewhere={isEditingAppearance || hasPendingSales || isEditingCash || isReturning || isAdministering || isViewingDashboard}
        isOwner={isOwner}
        onOpenAppearance={openAppearance}
        onSignOut={onSignOut}
        onOpenCash={openCash}
        onOpenReturns={openReturns}
        onOpenAdmin={openAdmin}
        {...(dashboardApi === undefined ? {} : { onOpenDashboard: openDashboard })}
        onCashChanged={refreshCash}
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
      {isAdministering && !hasPendingSales && (
        <AdminDialog posApi={posApi} {...(pricingApi === undefined ? {} : { pricingApi })} {...(productApi === undefined ? {} : { productApi })} {...(dashboardApi === undefined ? {} : { onOpenDashboard: openDashboardFromAdmin })} onClose={closeAdmin} />
      )}
      {isViewingDashboard && !hasPendingSales && dashboardApi !== undefined && <DashboardDialog api={dashboardApi} user={user} onClose={closeDashboard} />}
      {isReturning && !hasPendingSales && <ReturnDialog posApi={posApi} user={user} onReturned={refreshCash} onClose={closeReturns} />}
      {isEditingCash && !hasPendingSales && cash !== null && (
        <CashDialog posApi={posApi} user={user} status={cash} onStatusChange={setCash} onClose={closeCash} />
      )}
      {isEditingAppearance && !hasPendingSales && (
        <AppearanceDialog saved={appearance} onPreview={applyAppearance} onSave={saveAppearance} onClose={closeAppearance} />
      )}
      {hasPendingSales && <PendingSaleDialog sales={pendingSales.sales} onAnswer={pendingSales.answer} />}
    </div>
  );
}
