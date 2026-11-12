import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, dialog, safeStorage } from 'electron';

import { AdminActions, type PassphraseVault } from './admin/admin-actions';
import { applyPendingRestore } from './backup/backup-service';
import { CatalogImporter } from './import/catalog-importer';
import { AuditLog } from './audit/audit-log';
import { OwnerGate } from './auth/owner-gate';
import { InventoryService } from './inventory/inventory-service';
import { StockStore } from './inventory/stock-store';

import { AuthService } from './auth/auth-service';
import { CashService } from './cash/cash-service';
import { CashSessionStore } from './cash/cash-session-store';
import { UserStore } from './auth/user-store';
import { PendingSales } from './checkout/pending-sales';
import { DashboardExporter } from './reports/dashboard-exporter';
import { DashboardService } from './reports/dashboard-service';
import { printHtmlToPdf } from './reports/pdf-printer';
import { ReportService } from './reports/report-service';
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
import { PriceChangeService } from './pricing/price-change-service';
import { ProductReader } from './products/product-reader';
import { electronExportPorts } from './purchasing/electron-export-ports';
import { OrderExporter } from './purchasing/order-exporter';
import { PurchaseOrderService } from './purchasing/purchase-order-service';
import { SupplierService } from './purchasing/supplier-service';
import { ProductService } from './products/product-service';
import { seedSampleCatalogIfEmpty } from './local-store/sample-catalog';
import { SaleStore } from './local-store/sale-store';
import { openMainWindow } from './main-window';
import { startSyncIfConfigured } from './sync/start-sync';

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
    // A restore that was waiting for the restart is applied before the database opens, and the old one is kept beside it.
    applyPendingRestore(app.getPath('userData'), DATABASE_FILE_NAME);
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

const BACKUP_KEY_FILE_NAME = 'backup.key';
const BACKUP_INTERVAL_MS = 60 * 60 * 1000;

/** The passphrase of the backups, kept encrypted by Windows for this user, so it is never in the database or in plain text. */
function backupVault(): PassphraseVault {
  const file = join(app.getPath('userData'), BACKUP_KEY_FILE_NAME);
  return {
    read: () => {
      if (!existsSync(file) || !safeStorage.isEncryptionAvailable()) {
        return null;
      }
      return safeStorage.decryptString(readFileSync(file));
    },
    save: (passphrase) => {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Windows cannot protect the passphrase on this computer');
      }
      writeFileSync(file, safeStorage.encryptString(passphrase));
    },
  };
}

async function pickPath(properties: ('openFile' | 'openDirectory')[], title: string): Promise<string | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog({ title, properties });
  return canceled ? null : (filePaths[0] ?? null);
}

async function pickSavePath(title: string, defaultName: string, filterName: string, extension: string): Promise<string | null> {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title,
    defaultPath: join(app.getPath('documents'), defaultName),
    filters: [{ name: filterName, extensions: [extension] }],
  });
  return canceled || filePath === undefined ? null : filePath;
}

async function start(): Promise<void> {
  await app.whenReady();
  const store = openLocalStore();
  // Without POS_SYNC_URL the register sells as usual and keeps its operations until a core is configured.
  const sync = startSyncIfConfigured(store, LOCAL_TENANT_ID, process.env.POS_SYNC_URL, process.env.POS_DEVICE_TOKEN);
  app.once('will-quit', () => sync?.stop());
  const rendererEntry = resolveRendererEntry();
  const catalog = new ProductCatalog(store, LOCAL_TENANT_ID);
  const sales = new SaleStore(store, LOCAL_TENANT_ID);
  const appearance = new AppearanceStore(store, LOCAL_TENANT_ID);
  const auth = new AuthService(new UserStore(store, LOCAL_TENANT_ID));
  const cashStore = new CashSessionStore(store, LOCAL_TENANT_ID);
  const cash = new CashService(cashStore, auth);
  const admin = new AdminActions({
    store,
    importer: new CatalogImporter(store, LOCAL_TENANT_ID, new StockStore(store, LOCAL_TENANT_ID)),
    settings: cashStore,
    vault: backupVault(),
    userDataDirectory: app.getPath('userData'),
    pickFile: (title) => pickPath(['openFile'], title),
    pickFolder: (title) => pickPath(['openDirectory'], title),
  });
  // One copy an hour, and one soon after starting. A failure is kept in the status instead of stopping the register.
  const backupTimer = setInterval(() => admin.backupNow(), BACKUP_INTERVAL_MS);
  backupTimer.unref();
  app.once('will-quit', () => clearInterval(backupTimer));
  const printer = choosePrinter();
  // The drawer hangs from the printer, so both are real once the printer is configured and fakes until then (ADR 0028).
  const checkout = new SaleCheckout({
    hardware: { ...createFakeHardware(), printer, cashDrawer: new PrinterCashDrawer(printer) },
    sales,
    renderTicket: (sale, receipt) =>
      renderTicket(toTicketData(appearance.read().businessName || UNNAMED_BUSINESS, sale, { ...receipt, isReprint: false })),
  });
  const prices = new PriceChangeService(store, LOCAL_TENANT_ID, auth, catalog, new AuditLog(store, LOCAL_TENANT_ID));
  const inventory = new InventoryService(store, LOCAL_TENANT_ID, auth, new StockStore(store, LOCAL_TENANT_ID), new AuditLog(store, LOCAL_TENANT_ID), catalog);
  const products = new ProductService(store, LOCAL_TENANT_ID, auth, new AuditLog(store, LOCAL_TENANT_ID), new ProductReader(store, LOCAL_TENANT_ID), catalog, inventory);
  const dashboard = new DashboardService(store, LOCAL_TENANT_ID, new OwnerGate(auth, new AuditLog(store, LOCAL_TENANT_ID)));
  const productReader = new ProductReader(store, LOCAL_TENANT_ID);
  const suppliers = new SupplierService(store, LOCAL_TENANT_ID, auth, new AuditLog(store, LOCAL_TENANT_ID));
  const orders = new PurchaseOrderService(store, LOCAL_TENANT_ID, auth, new AuditLog(store, LOCAL_TENANT_ID), suppliers, productReader, catalog);
  const exporter = new OrderExporter(
    auth,
    new AuditLog(store, LOCAL_TENANT_ID),
    (orderId) => orders.get(orderId),
    electronExportPorts(() => appearance.read().businessName || UNNAMED_BUSINESS),
  );
  registerIpcHandlers(rendererEntry, {
    purchasing: { suppliers, orders, exporter },
    auth,
    dashboard,
    dashboardExporter: new DashboardExporter(dashboard, {
      pickSavePath,
      renderPdf: printHtmlToPdf,
      businessName: () => appearance.read().businessName || UNNAMED_BUSINESS,
    }),
    cash,
    prices,
    products,
    returns: new ReturnService(new ReturnStore(store, LOCAL_TENANT_ID), auth, cash),
    admin,
    inventory,
    reports: new ReportService(store, LOCAL_TENANT_ID, auth),
    catalog,
    appearance,
    pendingSales: new PendingSales(catalog, sales, () => {
      const cashierId = auth.currentUser()?.id;
      const cashSessionId = cash.openSessionId();
      return cashierId === undefined || cashSessionId === null ? null : { cashierId, cashSessionId };
    }, { auth, audit: new AuditLog(store, LOCAL_TENANT_ID) }, prices),
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
