import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, dialog } from 'electron';

import { AuthService } from './auth/auth-service';
import { CashService } from './cash/cash-service';
import { CashSessionStore } from './cash/cash-session-store';
import { UserStore } from './auth/user-store';
import { PendingSales } from './checkout/pending-sales';
import { ReturnService } from './returns/return-service';
import { ReturnStore } from './returns/return-store';
import { SaleCheckout } from './checkout/sale-checkout';
import { SalePayments } from './checkout/sale-payments';
import { renderTicket } from './checkout/ticket/ticket';
import { toTicketData } from './checkout/ticket/ticket-data';
import { createFakeHardware } from './hardware/fakes/fake-hardware';
import { RecordingPrinter } from './hardware/fakes/recording-printer';
import { PrinterCashDrawer } from './hardware/printer-cash-drawer';
import type { PrinterProvider } from './hardware/printer-provider';
import { WindowsSharedPrinter } from './hardware/windows-shared-printer';
import { registerIpcHandlers } from './ipc-handlers';
import { AppearanceStore } from './local-store/appearance-store';
import { LocalStore } from './local-store/local-store';
import { LOCAL_TENANT_ID } from './local-store/local-tenant';
import { ProductCatalog } from './local-store/product-catalog';
import { seedSampleCatalogIfEmpty } from './local-store/sample-catalog';
import { SaleStore } from './local-store/sale-store';
import { openMainWindow } from './main-window';

const PRELOAD_PATH = join(import.meta.dirname, '../preload/index.cjs');
const RENDERER_HTML_PATH = join(import.meta.dirname, '../renderer/index.html');
const DATABASE_FILE_NAME = 'pos.db';
const UNNAMED_BUSINESS = 'Tlapalería';

/** Uses the dev server while developing. A packaged app ignores the variable, so nothing can point it at another page. */
function resolveRendererEntry(): string {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  return !app.isPackaged && devServerUrl ? devServerUrl : pathToFileURL(RENDERER_HTML_PATH).href;
}

/**
 * Runs before any window opens, so the screen never works on a schema that is out of date. Without a
 * window the cashier would see nothing, so a failure here is the one startup error that gets a message.
 *
 * @returns the open store, which closes by itself when the app quits
 */
function openLocalStore(): LocalStore {
  try {
    const store = LocalStore.open({
      path: join(app.getPath('userData'), DATABASE_FILE_NAME),
      appVersion: app.getVersion(),
    });
    app.once('will-quit', () => store.close());
    seedSampleCatalogIfEmpty(store, LOCAL_TENANT_ID);
    return store;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox(
      'La caja no pudo abrir su base de datos',
      `No se abrió para no dañar los datos. Avísale a soporte y compárteles este mensaje:\n\n${detail}`,
    );
    throw error;
  }
}

/**
 * Picks the ticket printer. `POS_PRINTER_SHARE` names a printer shared by Windows, such as `\\localhost\TM-T20`. Without
 * it the register sells normally and prints nothing, because a missing printer must never stop a sale.
 */
function choosePrinter(): PrinterProvider {
  const share = process.env.POS_PRINTER_SHARE;
  return share ? new WindowsSharedPrinter(share) : new RecordingPrinter();
}

async function start(): Promise<void> {
  await app.whenReady();
  const store = openLocalStore();
  const rendererEntry = resolveRendererEntry();
  const catalog = new ProductCatalog(store, LOCAL_TENANT_ID);
  const sales = new SaleStore(store, LOCAL_TENANT_ID);
  const appearance = new AppearanceStore(store, LOCAL_TENANT_ID);
  const auth = new AuthService(new UserStore(store, LOCAL_TENANT_ID));
  const cash = new CashService(new CashSessionStore(store, LOCAL_TENANT_ID), auth);
  const printer = choosePrinter();
  // The drawer hangs from the printer, so both are real once the printer is configured and fakes until then (ADR 0028).
  const checkout = new SaleCheckout({
    hardware: { ...createFakeHardware(), printer, cashDrawer: new PrinterCashDrawer(printer) },
    sales,
    renderTicket: (sale, receipt) =>
      renderTicket(toTicketData(appearance.read().businessName || UNNAMED_BUSINESS, sale, { ...receipt, isReprint: false })),
  });
  registerIpcHandlers(rendererEntry, {
    auth,
    cash,
    returns: new ReturnService(new ReturnStore(store, LOCAL_TENANT_ID), auth, cash),
    catalog,
    appearance,
    pendingSales: new PendingSales(catalog, sales, () => {
      const cashierId = auth.currentUser()?.id;
      const cashSessionId = cash.openSessionId();
      return cashierId === undefined || cashSessionId === null ? null : { cashierId, cashSessionId };
    }),
    salePayments: new SalePayments(sales, checkout, {
      printer,
      businessName: () => appearance.read().businessName || UNNAMED_BUSINESS,
    }),
  });
  await openMainWindow(rendererEntry, PRELOAD_PATH);
}

start().catch((error: unknown) => {
  console.error('The register failed to start', error);
  app.exit(1);
});
