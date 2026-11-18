import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { DEFAULT_APPEARANCE, type Appearance } from '../shared/appearance';
import type { UserSummary } from '../shared/auth';
import type { AuthState, PosApi } from '../shared/pos-api';
import type { PricingApi } from '../shared/pricing';
import type { ProductAdminApi } from '../shared/product-admin';
import { comboLabel, DEFAULT_KEYMAP, type KeyAction, type Keymap, type ToolsApi } from '../shared/register-tools';
import type { ExpensesApi } from '../shared/expenses';
import type { MissingItemsApi } from '../shared/missing-items';
import type { SupplierCatalogApi } from '../shared/supplier-catalog';
import type { PurchasingApi } from '../shared/supplier-order';
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
import { MissingItemsDialog } from './missing/MissingItemsDialog';
import { SupplierOrderDialog } from './purchasing/SupplierOrderDialog';
import { SaleScreen } from './sale/SaleScreen';
import { SalesHistoryDialog } from './tools/SalesHistoryDialog';
import { SettingsDialog } from './tools/SettingsDialog';

type AppInfoState = { status: 'loading' } | { status: 'ready'; version: string } | { status: 'failed' };

const UNNAMED_REGISTER = 'Caja';

/** The keys that never change, because the scanner and the hands of the cashier count on them. */
const FIXED_SHORTCUTS: readonly { readonly keys: string; readonly action: string }[] = [
  { keys: 'Enter', action: 'Agregar' },
  { keys: '↑ ↓', action: 'Moverse' },
  { keys: '+ −', action: 'Cantidad' },
  { keys: 'Supr', action: 'Quitar' },
  { keys: 'Esc', action: 'Limpiar' },
];

/** The actions the footer reminds of, with the name it shows for each. The rest have a button in the header. */
const FOOTER_ACTIONS: readonly { readonly action: KeyAction; readonly label: string }[] = [
  { action: 'checkout', label: 'Cobrar' },
  { action: 'misc', label: 'Varios' },
  { action: 'linePrice', label: 'Precio' },
  { action: 'cancelSale', label: 'Cancelar venta' },
  { action: 'newProduct', label: 'Producto nuevo' },
  { action: 'productPanel', label: 'Producto' },
  { action: 'supplierOrder', label: 'Pedido' },
  { action: 'reprint', label: 'Reimprimir' },
];

interface AppProps {
  readonly posApi: PosApi;
  /** Changing the price of a product (E1-39). Without it, the register offers no price change. */
  readonly pricingApi?: PricingApi;
  /** Adding products that are not in the catalog (E1-42). Without it, the register offers no product form. */
  readonly productApi?: ProductAdminApi;
  /** The summary of the business (E1-45). Without it, the register offers no summary. */
  readonly dashboardApi?: DashboardApi;
  /** Orders to suppliers (E1-44). Without it, the register offers no purchase order. */
  readonly purchasingApi?: PurchasingApi;
  /** Bridge for the price lists of the suppliers, only for the owner. */
  readonly catalogApi?: SupplierCatalogApi;
  /** The log of what customers ask for and the store does not carry (E1-49). Without it, the register offers no log. */
  readonly missingApi?: MissingItemsApi;
  /** The keys, the ticket, the printer and the list of sales. Without it, the register keeps its keys and offers no settings. */
  readonly toolsApi?: ToolsApi;
  /** The operating expenses (E1-56). Without it, the summary has no «Gastos» tab. */
  readonly expensesApi?: ExpensesApi;
}

/**
 * The register. It receives the bridge as a prop, so it never touches what lies behind it. It shows the sign-in until a
 * person enters, and the register screen after that.
 *
 * @param props.posApi bridge to the main process
 * @param props.pricingApi bridge for changing prices, when the register offers it
 * @param props.productApi bridge for adding products, when the register offers it
 * @param props.dashboardApi bridge for the summary of the business, when the register offers it
 * @param props.purchasingApi bridge for the orders to suppliers, when the register offers it
 * @param props.toolsApi bridge for the settings and the list of sales, when the register offers them
 * @param props.expensesApi bridge for the operating expenses, when the register offers them
 * @returns the screen
 */
export function App({ posApi, pricingApi, productApi, dashboardApi, purchasingApi, catalogApi, toolsApi, missingApi, expensesApi }: AppProps): ReactElement {
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
      {...(purchasingApi === undefined ? {} : { purchasingApi })}
      {...(catalogApi === undefined ? {} : { catalogApi })}
      {...(missingApi === undefined ? {} : { missingApi })}
      {...(toolsApi === undefined ? {} : { toolsApi })}
      {...(expensesApi === undefined ? {} : { expensesApi })}
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
  readonly purchasingApi?: PurchasingApi;
  /** Bridge for the price lists of the suppliers, only for the owner. */
  readonly catalogApi?: SupplierCatalogApi;
  /** The log of what customers ask for and the store does not carry (E1-49). Without it, the register offers no log. */
  readonly missingApi?: MissingItemsApi;
  readonly toolsApi?: ToolsApi;
  readonly expensesApi?: ExpensesApi;
  readonly user: UserSummary;
  readonly appearance: Appearance;
  readonly onAppearanceSaved: (appearance: Appearance) => void;
  readonly onSignOut: () => void;
}

function RegisterScreen({ posApi, pricingApi, productApi, dashboardApi, purchasingApi, catalogApi, toolsApi, missingApi, expensesApi, user, appearance, onAppearanceSaved, onSignOut }: RegisterScreenProps): ReactElement {
  const [appInfo, setAppInfo] = useState<AppInfoState>({ status: 'loading' });
  const [isEditingAppearance, setIsEditingAppearance] = useState(false);
  const [cash, setCash] = useState<CashStatus | null>(null);
  const [isEditingCash, setIsEditingCash] = useState(false);
  const [isReturning, setIsReturning] = useState(false);
  const [isAdministering, setIsAdministering] = useState(false);
  const [isViewingDashboard, setIsViewingDashboard] = useState(false);
  // Where the orders to suppliers were opened from, so closing them goes back there.
  const [ordering, setOrdering] = useState<'sale' | 'admin' | null>(null);
  const [keymap, setKeymap] = useState<Keymap>(DEFAULT_KEYMAP);
  const [isEditingSettings, setIsEditingSettings] = useState(false);
  const [isViewingSales, setIsViewingSales] = useState(false);
  // What the log of missing items opened with: null while it is closed.
  const [missingFor, setMissingFor] = useState<string | null>(null);
  const pendingSales = usePendingSales(posApi);
  const hasPendingSales = pendingSales.sales.length > 0;
  const isOwner = user.role === 'owner';

  useEffect(() => {
    posApi.getAppInfo().then(
      ({ version }) => setAppInfo({ status: 'ready', version }),
      () => setAppInfo({ status: 'failed' }),
    );
  }, [posApi]);

  useEffect(() => {
    // Selling matters more than the keys, so a keymap that cannot be read leaves the ones the register was born with.
    toolsApi?.getKeymap().then(setKeymap, () => undefined);
  }, [toolsApi]);

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
  const openOrders = useCallback(() => setOrdering('sale'), []);
  const openOrdersFromAdmin = useCallback(() => {
    setIsAdministering(false);
    setOrdering('admin');
  }, []);
  const closeOrders = useCallback(() => {
    setIsAdministering(ordering === 'admin' && isOwner);
    setOrdering(null);
  }, [ordering, isOwner]);
  const openSettings = useCallback(() => setIsEditingSettings(isOwner && toolsApi !== undefined), [isOwner, toolsApi]);
  const closeSettings = useCallback(() => setIsEditingSettings(false), []);
  const openSales = useCallback(() => setIsViewingSales(toolsApi !== undefined), [toolsApi]);
  const closeSales = useCallback(() => setIsViewingSales(false), []);
  const openMissing = useCallback((text: string) => setMissingFor(missingApi === undefined ? null : text), [missingApi]);
  const closeMissing = useCallback(() => setMissingFor(null), []);
  const key = (action: KeyAction): string => comboLabel(keymap[action]);
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
            Administración <kbd>{key('admin')}</kbd>
          </button>
        )}
        {isOwner && (
          <button type="button" className="header-button" tabIndex={-1} onClick={openAppearance}>
            Apariencia <kbd>{key('appearance')}</kbd>
          </button>
        )}
        {dashboardApi !== undefined && (
          <button type="button" className="header-button" tabIndex={-1} onClick={openDashboard}>
            Resumen <kbd>{key('dashboard')}</kbd>
          </button>
        )}
        {isOwner && toolsApi !== undefined && (
          <button type="button" className="header-button" tabIndex={-1} onClick={openSettings}>
            Ajustes <kbd>{key('settings')}</kbd>
          </button>
        )}
        {toolsApi !== undefined && (
          <button type="button" className="header-button" tabIndex={-1} onClick={openSales}>
            Ventas <kbd>{key('salesHistory')}</kbd>
          </button>
        )}
        {missingApi !== undefined && (
          <button type="button" className="header-button" tabIndex={-1} onClick={() => openMissing('')}>
            Faltantes <kbd>{key('missingItems')}</kbd>
          </button>
        )}
        <button type="button" className="header-button" tabIndex={-1} onClick={openReturns}>
          Devolución <kbd>{key('returns')}</kbd>
        </button>
        <button type="button" className="header-button" tabIndex={-1} onClick={openCash}>
          Caja <kbd>{key('cash')}</kbd>
        </button>
        <button type="button" className="header-button" tabIndex={-1} onClick={onSignOut}>
          Salir <kbd>{key('signOut')}</kbd>
        </button>
      </header>
      {cash?.shouldWithdraw === true && (
        <p className="notice register-banner" role="status">
          Hay mucho efectivo en el cajón. Haz un retiro parcial cuando puedas ({key('cash')}). Puedes seguir vendiendo.
        </p>
      )}
      <SaleScreen
        posApi={posApi}
        {...(pricingApi === undefined ? {} : { pricingApi })}
        {...(productApi === undefined ? {} : { productApi })}
        isKeyboardElsewhere={isEditingAppearance || hasPendingSales || isEditingCash || isReturning || isAdministering || isViewingDashboard || ordering !== null || isEditingSettings || isViewingSales || missingFor !== null}
        isOwner={isOwner}
        onOpenAppearance={openAppearance}
        onSignOut={onSignOut}
        onOpenCash={openCash}
        onOpenReturns={openReturns}
        onOpenAdmin={openAdmin}
        {...(dashboardApi === undefined ? {} : { onOpenDashboard: openDashboard })}
        {...(purchasingApi === undefined ? {} : { onOpenSupplierOrder: openOrders, purchasingApi })}
        {...(missingApi === undefined ? {} : { onOpenMissingItems: openMissing })}
        onCashChanged={refreshCash}
        keymap={keymap}
        {...(toolsApi === undefined ? {} : { toolsApi, onOpenSettings: openSettings, onOpenSalesHistory: openSales })}
      />
      <footer className="register-footer">
        <ul className="shortcuts" aria-label="Atajos de teclado">
          {FIXED_SHORTCUTS.map(({ keys, action }) => (
            <li key={action}>
              <kbd>{keys}</kbd> {action}
            </li>
          ))}
          {FOOTER_ACTIONS.map(({ action, label }) => (
            <li key={action}>
              <kbd>{key(action)}</kbd> {label}
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
        <AdminDialog posApi={posApi} {...(pricingApi === undefined ? {} : { pricingApi })} {...(productApi === undefined ? {} : { productApi })} {...(dashboardApi === undefined ? {} : { onOpenDashboard: openDashboardFromAdmin })} {...(purchasingApi === undefined ? {} : { onOpenSupplierOrder: openOrdersFromAdmin })} onClose={closeAdmin} />
      )}
      {isViewingDashboard && !hasPendingSales && dashboardApi !== undefined && <DashboardDialog api={dashboardApi} user={user} onClose={closeDashboard} {...(toolsApi === undefined ? {} : { searchSales: (text: string) => toolsApi.listRecentSales(text) })} {...(expensesApi === undefined ? {} : { expensesApi })} />}
      {ordering !== null && !hasPendingSales && purchasingApi !== undefined && <SupplierOrderDialog api={purchasingApi} {...(catalogApi === undefined ? {} : { catalogApi })} isOwner={isOwner} onClose={closeOrders} />}
      {isEditingSettings && !hasPendingSales && toolsApi !== undefined && (
        <SettingsDialog toolsApi={toolsApi} keymap={keymap} onKeymapSaved={setKeymap} onClose={closeSettings} />
      )}
      {isViewingSales && !hasPendingSales && toolsApi !== undefined && (
        <SalesHistoryDialog posApi={posApi} toolsApi={toolsApi} isOwner={isOwner} onCancelled={refreshCash} onClose={closeSales} />
      )}
      {missingFor !== null && !hasPendingSales && missingApi !== undefined && (
        <MissingItemsDialog api={missingApi} isOwner={isOwner} initialDescription={missingFor} onClose={closeMissing} />
      )}
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
