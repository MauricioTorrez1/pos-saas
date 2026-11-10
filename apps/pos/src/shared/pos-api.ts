import type { Quantity, TaxRate, Unit } from '@pos-saas/money';

import type { Appearance } from './appearance';
import type { BackupOutcome, BackupStatus, ImportOutcome, RestoreOutcome } from './admin-api';
import type { LoginResult, UserRole, UserSummary } from './auth';
import type { AdjustStockRequest, AdjustStockResult, Kardex, LedgerCheck } from './inventory-api';
import type { DailyReport } from './report-api';
import type { FindReturnableResult, ReturnRequest, ReturnResult } from './returns-api';
import type {
  CashMovementRequest,
  CashMovementResult,
  CashStatus,
  CloseCashRequest,
  CloseCashResult,
  OpenCashResult,
} from './cash-api';
import type { PaymentPlan } from './payment-plan';

/** Channels between the preload bridge and the main process. */
export const IPC_CHANNELS = {
  getAppInfo: 'app:get-info',
  getAuthState: 'auth:get-state',
  setupOwner: 'auth:setup-owner',
  login: 'auth:login',
  logout: 'auth:logout',
  createUser: 'auth:create-user',
  importCatalog: 'admin:import-catalog',
  getBackupStatus: 'admin:backup-status',
  configureBackup: 'admin:configure-backup',
  backupNow: 'admin:backup-now',
  restoreBackup: 'admin:restore-backup',
  getKardex: 'inventory:get-kardex',
  adjustStock: 'inventory:adjust',
  checkLedger: 'inventory:check-ledger',
  getDailyReport: 'reports:daily',
  findReturnableSale: 'returns:find-sale',
  createReturn: 'returns:create',
  getCashStatus: 'cash:get-status',
  openCashSession: 'cash:open',
  recordCashMovement: 'cash:record-movement',
  closeCashSession: 'cash:close',
  setWithdrawalLimit: 'cash:set-limit',
  findProductByCode: 'catalog:find-by-code',
  searchProducts: 'catalog:search',
  getAppearance: 'appearance:get',
  saveAppearance: 'appearance:save',
  savePendingSale: 'sales:save-pending',
  checkoutSale: 'sales:checkout',
  reprintLastTicket: 'sales:reprint-last',
  listPendingSales: 'sales:list-pending',
  confirmPendingSale: 'sales:confirm-pending',
  cancelPendingSale: 'sales:cancel-pending',
} as const;

/** Longest text the screen can look up, which is more than any barcode or product name a person would enter. */
export const MAX_LOOKUP_TEXT_LENGTH = 100;

/** Facts about the running app that the screen may show. */
export interface AppInfo {
  readonly version: string;
}

/** A product as the sale screen needs it. Its amounts follow the scales of ADR 0011. */
export interface CatalogProduct {
  /** UUIDv7 of the product. */
  readonly id: string;
  readonly name: string;
  readonly unit: Unit;
  /** Price per unit with VAT, in ten-thousandths of a peso: $12.50 is 125000. */
  readonly unitPriceE4: number;
  readonly taxRate: TaxRate;
}

/** A sale the screen wants saved before anything is charged. The prices come from the catalog, not from the screen. */
export interface PendingSaleRequest {
  /** A UUID the screen creates once per sale. Sending it again returns the same sale instead of a second one. */
  readonly idempotencyKey: string;
  readonly lines: readonly PendingSaleRequestLine[];
  /** The total the customer sees, in cents. If the catalog gives another total, the sale is not saved. */
  readonly expectedTotalCents: number;
  /** The PIN of the owner, when a cashier sells a miscellaneous item. The owner needs no PIN. */
  readonly ownerPin?: string;
}

/** A line of a sale to save: a product of the catalog, or a miscellaneous item with a price the person typed (RF-003). */
export type PendingSaleRequestLine =
  | {
      readonly productId: string;
      /** Thousandths of the base unit of the product: 3.275 m is 3275. */
      readonly quantityMilli: number;
    }
  | {
      /** What it is, as it will appear on the ticket. */
      readonly miscellaneous: { readonly name: string; readonly unitPriceE4: number };
      /** Thousandths of a piece, always a whole number of pieces. */
      readonly quantityMilli: number;
    };

/** One product of a sale waiting to be resolved. */
export interface PendingSaleLine {
  readonly productName: string;
  readonly quantity: Quantity;
  /** Price per unit with VAT, in ten-thousandths of a peso. */
  readonly unitPriceE4: number;
  /** What the customer pays for the line, in cents. */
  readonly totalCents: number;
}

/** A sale saved before being charged, which nobody has confirmed or cancelled yet (ADR 0010). */
export interface PendingSale {
  /** UUIDv7 of the sale. */
  readonly id: string;
  /** When it was saved, in ISO 8601. */
  readonly occurredAt: string;
  readonly lines: readonly PendingSaleLine[];
  /** What the customer pays, in cents. */
  readonly totalCents: number;
}

/** How saving a pending sale ended. */
export type SavePendingSaleResult =
  | { readonly status: 'saved'; readonly sale: PendingSale }
  /** A product no longer exists or its price changed, so the screen shows a sale that does not match. Nothing was saved. */
  | { readonly status: 'catalog_changed' }
  /** The register is closed: nothing is sold until somebody opens it with a float (RF-024). */
  | { readonly status: 'no_cash_session' }
  /** A cashier sold a miscellaneous item without the PIN of the owner. Nothing was saved. */
  | { readonly status: 'authorization_required' }
  | { readonly status: 'wrong_pin'; readonly attemptsLeft: number }
  | { readonly status: 'locked'; readonly until: string };

/** What the customer handed over for a saved sale. The main process works out the payments and the change itself. */
export interface PaymentRequest {
  /** UUIDv7 of the saved sale. */
  readonly saleId: string;
  /** All the cash received, in cents. 0 if nothing was paid in cash. */
  readonly cashReceivedCents: number;
  readonly transfers: readonly {
    /** What the transfer paid, in cents. */
    readonly amountCents: number;
    /** The reference the bank gave. */
    readonly reference: string;
  }[];
  /** Payments on the standalone card terminal, each with the folio the cashier typed (RF-016). */
  readonly cards?: readonly {
    readonly amountCents: number;
    /** The folio of the terminal. Never a card number. */
    readonly reference: string;
  }[];
}

/** A device that failed after the sale was completed. The sale stands. */
export interface CheckoutProblem {
  readonly device: string;
  readonly message: string;
}

/** How a request to collect a sale ended. */
export type CheckoutSaleResult =
  | {
      readonly status: 'completed';
      /** The short folio of the sale, such as `T1-000123`. It is on the ticket. */
      readonly folio: string;
      /** Cash to give back, in cents. */
      readonly changeCents: number;
      readonly problems: readonly CheckoutProblem[];
    }
  /** What was handed over does not complete the sale (RF-014, RF-015). Nothing was recorded. */
  | { readonly status: 'payment_refused'; readonly plan: PaymentPlan };

/** How asking to print the last ticket again ended. */
export type ReprintResult =
  | { readonly status: 'printed'; readonly folio: string }
  /** No sale has been completed yet, so there is no ticket to print. */
  | { readonly status: 'no_sales' }
  /** The printer did not take the job. The sale is not affected. */
  | { readonly status: 'printer_failed'; readonly folio: string; readonly message: string };

/** Who can sign in at this register and who is signed in. */
export interface AuthState {
  /** True when nobody was registered yet, so the first person must become the owner. */
  readonly needsSetup: boolean;
  readonly users: readonly UserSummary[];
  readonly current: UserSummary | null;
}

/** Everything the screen can ask of the main process. */
export interface PosApi {
  /**
   * Reads the facts about the running app.
   *
   * @returns the app version, as the main process knows it
   */
  getAppInfo(): Promise<AppInfo>;

  /**
   * Asks for the file of products of Eleventa and loads it with its stock (RF-034). Only the owner.
   *
   * @returns what was loaded, or why not
   */
  importCatalog(): Promise<ImportOutcome>;

  /**
   * Reads how the backups stand: where they go, when the last one was made, and whether the last attempt failed. Only the owner.
   *
   * @returns the status
   */
  getBackupStatus(): Promise<BackupStatus>;

  /**
   * Sets up the backups: asks for a folder, keeps the passphrase, and makes the first encrypted copy. Only the owner.
   *
   * @param request the passphrase, at least 8 characters
   * @returns how it ended
   */
  configureBackup(request: { readonly passphrase: string }): Promise<BackupOutcome>;

  /**
   * Makes an encrypted copy now. Only the owner.
   *
   * @returns how it ended
   */
  backupNow(): Promise<BackupOutcome>;

  /**
   * Asks for a backup and prepares it to be used when the register restarts. Only the owner.
   *
   * @param request the passphrase the backup was made with
   * @returns staged when the backup is healthy, or why not
   */
  restoreBackup(request: { readonly passphrase: string }): Promise<RestoreOutcome>;

  /**
   * Reads the history of a product with the balance after each movement (RF-031). Only the owner.
   *
   * @param productId the UUIDv7 of the product
   * @returns the kardex, or null if the product does not exist
   */
  getKardex(productId: string): Promise<Kardex | null>;

  /**
   * Corrects a count or writes off a loss, with the reason (RF-030). Only the owner.
   *
   * @param request the product, the type, the signed quantity and the reason
   * @returns the new kardex, or why nothing was recorded
   */
  adjustStock(request: AdjustStockRequest): Promise<AdjustStockResult>;

  /**
   * Compares the stock ledger with the sales and the returns. Only the owner.
   *
   * @returns how many movements were checked and everything that does not agree
   */
  checkLedger(): Promise<LedgerCheck>;

  /**
   * Reads the report of one day: sales, average ticket, margin, returns, and what ran out or is not selling (RF-049). Only the owner.
   *
   * @param date the day as `YYYY-MM-DD`, in the time zone of the register
   * @returns the report
   */
  getDailyReport(date: string): Promise<DailyReport>;

  /**
   * Finds the completed sale a customer wants to return from the folio on their ticket (RF-019).
   *
   * @param folio what was typed, such as T1-000123 or just 123`
   * @returns the sale with what can still come back from each line, or why it was not found
   */
  findReturnableSale(folio: string): Promise<FindReturnableResult>;

  /**
   * Records a return as a record next to the sale, which never changes. The owner authorizes it, it is refused by default
   * after 30 days or for cut-to-measure products, and it can never bring back more than was sold.
   *
   * @param request the sale, what comes back from each line, the reason, and the authorization
   * @returns what to give back by each means, or why the return was refused
   */
  createReturn(request: ReturnRequest): Promise<ReturnResult>;

  /**
   * Reads how the cash of the register stands: whether it is open, what is expected in the drawer, and whether to withdraw.
   *
   * @returns the status
   */
  getCashStatus(): Promise<CashStatus>;

  /**
   * Opens the register with the cash the cashier puts in the drawer (RF-024).
   *
   * @param request the float, which may be zero
   * @returns opened, or lready_open, because there is one session at a time
   */
  openCashSession(request: { readonly floatCents: number }): Promise<OpenCashResult>;

  /**
   * Records cash going into or out of the drawer, with its reason (RF-025). A cashier needs an owner's PIN to take cash out.
   *
   * @param request the kind, the amount, the reason, and the owner's PIN when needed
   * @returns ecorded with the new status, or why not
   */
  recordCashMovement(request: CashMovementRequest): Promise<CashMovementResult>;

  /**
   * Makes the cut with what was counted, and closes the register (RF-027).
   *
   * @param request the bills and coins, the card and transfer vouchers, and the reason if it does not balance
   * @returns closed with the cut, or why not
   */
  closeCashSession(request: CloseCashRequest): Promise<CloseCashResult>;

  /**
   * Changes the cash level that triggers the warning to withdraw cash (RF-026). Only the owner.
   *
   * @param request the new limit, in cents
   * @returns the new status
   */
  setWithdrawalLimit(request: { readonly limitCents: number }): Promise<CashStatus>;

  /**
   * Reads who can sign in and who is signed in. Nothing else works until somebody is.
   *
   * @returns whether the register needs its owner, the people who can sign in, and the person signed in
   */
  getAuthState(): Promise<AuthState>;

  /**
   * Creates the owner of a register that has nobody. It does not sign them in.
   *
   * @param request their name and a PIN of four to eight digits
   * @returns the owner
   */
  setupOwner(request: { readonly name: string; readonly pin: string }): Promise<UserSummary>;

  /**
   * Signs a person in with their PIN. It works without internet.
   *
   * @param request the person and their PIN
   * @returns ok, or why not: a wrong PIN with the tries left, or a lock after five wrong ones
   */
  login(request: { readonly userId: string; readonly pin: string }): Promise<LoginResult>;

  /**
   * Signs out whoever is signed in.
   *
   * @returns once nobody is signed in
   */
  logout(): Promise<void>;

  /**
   * Adds a person. Only the owner who is signed in can.
   *
   * @param request their name, their role, and a PIN of four to eight digits
   * @returns the new person
   */
  createUser(request: { readonly name: string; readonly role: UserRole; readonly pin: string }): Promise<UserSummary>;

  /**
   * Finds the product that has exactly this barcode.
   *
   * @param code the barcode, as scanned or typed
   * @returns the product, or null if no product has that code
   */
  findProductByCode(code: string): Promise<CatalogProduct | null>;

  /**
   * Finds products by the beginning of the words in their names. Accents and capitals do not matter.
   *
   * @param text what the cashier typed, such as "mart 16"
   * @returns the best matches first, at most 20
   */
  searchProducts(text: string): Promise<readonly CatalogProduct[]>;

  /**
   * Reads how the owner wants the register to look.
   *
   * @returns the saved appearance, or the default one if the owner never changed it
   */
  getAppearance(): Promise<Appearance>;

  /**
   * Saves how the owner wants the register to look.
   *
   * @param appearance the new appearance
   * @returns once it is safely on disk
   */
  saveAppearance(appearance: Appearance): Promise<void>;

  /**
   * Saves a sale as `pending_payment`, before anything is charged (ADR 0010).
   *
   * @param request the products, the quantities, and the total the customer sees
   * @returns the saved sale, or `catalog_changed` if the sale on the screen no longer matches the catalog
   */
  savePendingSale(request: PendingSaleRequest): Promise<SavePendingSaleResult>;

  /**
   * Collects a saved sale with cash and transfers (RF-014, RF-015). The main process checks that the payments add up
   * to the total, records them in one transaction, and only then opens the drawer and prints.
   *
   * @param request the sale and what the customer handed over
   * @returns `completed` with the change, or `payment_refused` with the reason and nothing recorded
   */
  checkoutSale(request: PaymentRequest): Promise<CheckoutSaleResult>;

  /**
   * Prints the ticket of the last completed sale again, marked as a reprint (RF-018). The sale does not change.
   *
   * @returns `printed` with the folio, `no_sales` if there is nothing to print, or `printer_failed` with why
   */
  reprintLastTicket(): Promise<ReprintResult>;

  /**
   * Reads the sales that were left without being confirmed or cancelled, as after a power cut (RF-017).
   *
   * @returns the sales, oldest first
   */
  listPendingSales(): Promise<readonly PendingSale[]>;

  /**
   * Confirms that a pending sale was paid, and how. It records the payments but does not open the drawer or print,
   * because the customer already left (ADR 0025).
   *
   * @param request the sale and what the customer paid it with
   * @returns `completed`, or `payment_refused` if what was told does not add up to the total
   */
  confirmPendingSale(request: PaymentRequest): Promise<CheckoutSaleResult>;

  /**
   * Cancels a pending sale that was not paid. The sale is kept, marked as cancelled.
   *
   * @param saleId the sale
   * @returns once it is safely on disk
   */
  cancelPendingSale(saleId: string): Promise<void>;
}
