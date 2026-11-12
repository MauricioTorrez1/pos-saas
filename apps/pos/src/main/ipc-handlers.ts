import { app, ipcMain } from 'electron';

import { isAppearance } from '../shared/appearance';
import type { LoginResult, UserSummary } from '../shared/auth';
import type { BackupOutcome, BackupStatus, ImportOutcome, RestoreOutcome } from '../shared/admin-api';
import type { AdjustStockResult, Kardex, LedgerCheck } from '../shared/inventory-api';
import type { ChangePriceResult, PriceInfo } from '../shared/pricing';
import type { CreateProductResult, ProductPanelDetail, ProductSummary, UpdateProductResult } from '../shared/product-admin';
import { DASHBOARD_CHANNELS, type DashboardResult, type ExportResult } from '../shared/dashboard-api';
import type { DailyReport } from '../shared/report-api';
import type { FindReturnableResult, ReturnResult } from '../shared/returns-api';
import type { CashMovementResult, CashStatus, CloseCashResult, OpenCashResult } from '../shared/cash-api';
import {
  IPC_CHANNELS,
  MAX_LOOKUP_TEXT_LENGTH,
  type AppInfo,
  type AuthState,
  type CatalogProduct,
  type CheckoutSaleResult,
  type PendingSale,
  type ReprintResult,
  type SavePendingSaleResult,
} from '../shared/pos-api';
import { parseCreateUserRequest, parseLoginRequest, parseSetupRequest } from './auth/auth-request';
import { parsePassphraseRequest } from './admin/admin-request';
import type { AdminActions } from './admin/admin-actions';
import type { AuthService } from './auth/auth-service';
import { parseCloseRequest, parseLimitRequest, parseMovementRequest, parseOpenRequest } from './cash/cash-request';
import type { CashService } from './cash/cash-service';
import { parseAdjustStockRequest, parseProductId } from './inventory/inventory-request';
import type { InventoryService } from './inventory/inventory-service';
import { parseChangePriceRequest } from './pricing/price-request';
import { parseNewProductRequest, parseUpdateProductRequest } from './products/product-request';
import type { ProductService } from './products/product-service';
import type { PriceChangeService } from './pricing/price-change-service';
import { parseDashboardRequest, parseExportFormat } from './reports/dashboard-request';
import type { DashboardExporter } from './reports/dashboard-exporter';
import type { DashboardService } from './reports/dashboard-service';
import { requireDayText } from './reports/report-request';
import type { ReportService } from './reports/report-service';
import { parseFolioText, parseReturnRequest } from './returns/return-request';
import type { ReturnService } from './returns/return-service';
import { parsePaymentRequest, parsePendingSaleRequest, parseSaleId } from './checkout/pending-sale-request';
import type { PendingSales } from './checkout/pending-sales';
import type { SalePayments } from './checkout/sale-payments';
import type { AppearanceStore } from './local-store/appearance-store';
import type { ProductCatalog } from './local-store/product-catalog';
import { registerPurchasingHandlers, type PurchasingServices } from './purchasing/purchasing-ipc';
import { assertTrustedSender } from './trusted-url';

const SEARCH_RESULT_LIMIT = 20;

/** What the handlers answer with. */
export interface IpcServices {
  readonly auth: AuthService;
  readonly cash: CashService;
  readonly returns: ReturnService;
  readonly admin: AdminActions;
  readonly inventory: InventoryService;
  readonly reports: ReportService;
  readonly dashboard: DashboardService;
  readonly dashboardExporter: DashboardExporter;
  readonly catalog: ProductCatalog;
  readonly prices: PriceChangeService;
  readonly products: ProductService;
  readonly appearance: AppearanceStore;
  readonly pendingSales: PendingSales;
  readonly salePayments: SalePayments;
  /** The suppliers and the purchase orders (E1-44). */
  readonly purchasing: PurchasingServices;
}

/** Nobody is signed in, or the person signed in may not do this. The screen should have shown the sign-in first. */
export class NotAllowedError extends Error {
  /** @param message what was refused */
  constructor(message: string) {
    super(message);
    this.name = 'NotAllowedError';
  }
}

/** Whatever crosses the bridge is checked again here, because the database must not depend on the screen being right. */
function requireLookupText(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_LOOKUP_TEXT_LENGTH) {
    throw new TypeError(`Expected a text of at most ${MAX_LOOKUP_TEXT_LENGTH} characters`);
  }
  return value;
}

/**
 * Registers what the main process answers to the screen. Every channel refuses calls from any other page, and everything
 * that touches sales or the catalog also refuses calls while nobody is signed in, so a screen that skipped the sign-in
 * could not sell.
 *
 * @param rendererEntry address the register screen was loaded from
 * @param services the local data the answers come from
 */
export function registerIpcHandlers(
  rendererEntry: string,
  { auth, cash, returns, admin, inventory, reports, dashboard, dashboardExporter, catalog, prices, products, appearance, pendingSales, salePayments, purchasing }: IpcServices,
): void {
  const answerScreen = <Result>(channel: string, respond: (argument: unknown) => Result): void => {
    ipcMain.handle(channel, (event, argument: unknown) => {
      assertTrustedSender(event.senderFrame?.url, rendererEntry);
      return respond(argument);
    });
  };
  const answerSignedIn = <Result>(channel: string, respond: (argument: unknown, user: UserSummary) => Result): void => {
    answerScreen(channel, (argument) => {
      const user = auth.currentUser();
      if (user === null) {
        throw new NotAllowedError('Sign in first');
      }
      return respond(argument, user);
    });
  };
  const answerOwner = <Result>(channel: string, respond: (argument: unknown) => Result): void => {
    answerSignedIn(channel, (argument, user) => {
      if (user.role !== 'owner') {
        throw new NotAllowedError('Only the owner can do this');
      }
      return respond(argument);
    });
  };

  answerScreen(IPC_CHANNELS.getAppInfo, (): AppInfo => ({ version: app.getVersion() }));
  answerScreen(IPC_CHANNELS.getAppearance, () => appearance.read());
  answerScreen(IPC_CHANNELS.getAuthState, (): AuthState => ({ needsSetup: auth.needsSetup(), users: auth.listUsers(), current: auth.currentUser() }));
  answerScreen(IPC_CHANNELS.setupOwner, (request): UserSummary => {
    const { name, pin } = parseSetupRequest(request);
    return auth.setupOwner(name, pin);
  });
  answerScreen(IPC_CHANNELS.login, (request): LoginResult => {
    const { userId, pin } = parseLoginRequest(request);
    return auth.login(userId, pin);
  });
  answerScreen(IPC_CHANNELS.logout, (): void => auth.logout());
  answerOwner(IPC_CHANNELS.createUser, (request): UserSummary => {
    const { name, role, pin } = parseCreateUserRequest(request);
    return auth.createUser(name, role, pin);
  });
  answerOwner(IPC_CHANNELS.saveAppearance, (value): void => {
    if (!isAppearance(value)) {
      throw new TypeError('Expected a complete appearance with allowed values');
    }
    appearance.save(value);
  });

  answerSignedIn(IPC_CHANNELS.findReturnableSale, (folio): FindReturnableResult => returns.findSale(parseFolioText(folio)));
  answerSignedIn(IPC_CHANNELS.createReturn, (request): ReturnResult => returns.create(parseReturnRequest(request)));
  answerSignedIn(IPC_CHANNELS.getCashStatus, (): CashStatus => cash.status());
  answerSignedIn(IPC_CHANNELS.openCashSession, (request): OpenCashResult => cash.open(parseOpenRequest(request)));
  answerSignedIn(IPC_CHANNELS.recordCashMovement, (request): CashMovementResult => cash.recordMovement(parseMovementRequest(request)));
  answerSignedIn(IPC_CHANNELS.closeCashSession, (request): CloseCashResult => cash.close(parseCloseRequest(request)));
  answerOwner(IPC_CHANNELS.setWithdrawalLimit, (request): CashStatus => cash.setWithdrawalLimit(parseLimitRequest(request)));

  answerOwner(IPC_CHANNELS.getKardex, (productId): Kardex | null => inventory.kardex(parseProductId(productId)));
  answerSignedIn(IPC_CHANNELS.adjustStock, (request): AdjustStockResult => inventory.adjust(parseAdjustStockRequest(request)));
  answerOwner(IPC_CHANNELS.checkLedger, (): LedgerCheck => inventory.verifyLedger());
  answerOwner(IPC_CHANNELS.getDailyReport, (date): DailyReport => reports.daily(requireDayText(date)));

  // A cashier may ask too: the service gives them only their shift, or the whole summary with the PIN of an owner.
  answerSignedIn(DASHBOARD_CHANNELS.getDashboard, (request, user): DashboardResult => dashboard.summary(parseDashboardRequest(request), user));
  answerSignedIn(DASHBOARD_CHANNELS.exportDashboard, (request, user): Promise<ExportResult> => {
    const format = parseExportFormat((request as { format?: unknown } | null)?.format);
    return dashboardExporter.export(parseDashboardRequest((request as { request?: unknown } | null)?.request), format, user);
  });

  answerOwner(IPC_CHANNELS.importCatalog, (): Promise<ImportOutcome> => admin.importCatalog());
  answerOwner(IPC_CHANNELS.getBackupStatus, (): BackupStatus => admin.backupStatus());
  answerOwner(IPC_CHANNELS.configureBackup, (request): Promise<BackupOutcome> => admin.configureBackup(parsePassphraseRequest(request)));
  answerOwner(IPC_CHANNELS.backupNow, (): BackupOutcome => admin.backupNow());
  answerOwner(IPC_CHANNELS.restoreBackup, (request): Promise<RestoreOutcome> => admin.restoreBackup(parsePassphraseRequest(request)));

  answerSignedIn(IPC_CHANNELS.findProductByCode, (code): CatalogProduct | null => catalog.findByCode(requireLookupText(code)));
  answerSignedIn(IPC_CHANNELS.searchProducts, (text): CatalogProduct[] => catalog.search(requireLookupText(text), SEARCH_RESULT_LIMIT));
  answerSignedIn(IPC_CHANNELS.getPriceInfo, (productId): PriceInfo | null => prices.info(parseProductId(productId)));
  answerSignedIn(IPC_CHANNELS.changePrice, (request): ChangePriceResult => prices.change(parseChangePriceRequest(request)));
  answerSignedIn(IPC_CHANNELS.createProduct, (request): CreateProductResult => products.create(parseNewProductRequest(request)));
  answerSignedIn(IPC_CHANNELS.findProducts, (text): ProductSummary[] => products.find(requireLookupText(text)));
  answerSignedIn(IPC_CHANNELS.getProductDetail, (productId): ProductPanelDetail | null => products.panelDetail(parseProductId(productId)));
  answerSignedIn(IPC_CHANNELS.updateProduct, (request): UpdateProductResult => products.update(parseUpdateProductRequest(request)));
  answerSignedIn(IPC_CHANNELS.savePendingSale, (request): SavePendingSaleResult => pendingSales.save(parsePendingSaleRequest(request)));
  answerSignedIn(IPC_CHANNELS.listPendingSales, (): PendingSale[] => pendingSales.list());
  answerSignedIn(IPC_CHANNELS.checkoutSale, (request): Promise<CheckoutSaleResult> => salePayments.checkout(parsePaymentRequest(request)));
  answerSignedIn(IPC_CHANNELS.reprintLastTicket, (): Promise<ReprintResult> => salePayments.reprintLast());
  answerSignedIn(IPC_CHANNELS.confirmPendingSale, (request): CheckoutSaleResult => salePayments.confirm(parsePaymentRequest(request)));
  answerSignedIn(IPC_CHANNELS.cancelPendingSale, (saleId): void => pendingSales.cancel(parseSaleId(saleId)));
  registerPurchasingHandlers(answerSignedIn, purchasing);
}
