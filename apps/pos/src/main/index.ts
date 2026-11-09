import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, dialog } from 'electron';

import { PendingSales } from './checkout/pending-sales';
import { SaleCheckout } from './checkout/sale-checkout';
import { SalePayments } from './checkout/sale-payments';
import { createFakeHardware } from './hardware/fakes/fake-hardware';
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

async function start(): Promise<void> {
  await app.whenReady();
  const store = openLocalStore();
  const rendererEntry = resolveRendererEntry();
  const catalog = new ProductCatalog(store, LOCAL_TENANT_ID);
  const sales = new SaleStore(store, LOCAL_TENANT_ID);
  // The real drawer and printer arrive with E1-14 and E1-13. Until then the fakes stand in, so no ticket is printed.
  const checkout = new SaleCheckout({ hardware: createFakeHardware(), sales, renderTicket: () => new Uint8Array() });
  registerIpcHandlers(rendererEntry, {
    catalog,
    appearance: new AppearanceStore(store, LOCAL_TENANT_ID),
    pendingSales: new PendingSales(catalog, sales),
    salePayments: new SalePayments(sales, checkout),
  });
  await openMainWindow(rendererEntry, PRELOAD_PATH);
}

start().catch((error: unknown) => {
  console.error('The register failed to start', error);
  app.exit(1);
});
