import { app, ipcMain } from 'electron';

import { isAppearance } from '../shared/appearance';
import type { LoginResult, UserSummary } from '../shared/auth';
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
import type { AuthService } from './auth/auth-service';
import { parsePaymentRequest, parsePendingSaleRequest, parseSaleId } from './checkout/pending-sale-request';
import type { PendingSales } from './checkout/pending-sales';
import type { SalePayments } from './checkout/sale-payments';
import type { AppearanceStore } from './local-store/appearance-store';
import type { ProductCatalog } from './local-store/product-catalog';
import { assertTrustedSender } from './trusted-url';

const SEARCH_RESULT_LIMIT = 20;

/** What the handlers answer with. */
export interface IpcServices {
  readonly auth: AuthService;
  readonly catalog: ProductCatalog;
  readonly appearance: AppearanceStore;
  readonly pendingSales: PendingSales;
  readonly salePayments: SalePayments;
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
  { auth, catalog, appearance, pendingSales, salePayments }: IpcServices,
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

  answerSignedIn(IPC_CHANNELS.findProductByCode, (code): CatalogProduct | null => catalog.findByCode(requireLookupText(code)));
  answerSignedIn(IPC_CHANNELS.searchProducts, (text): CatalogProduct[] => catalog.search(requireLookupText(text), SEARCH_RESULT_LIMIT));
  answerSignedIn(IPC_CHANNELS.savePendingSale, (request): SavePendingSaleResult => pendingSales.save(parsePendingSaleRequest(request)));
  answerSignedIn(IPC_CHANNELS.listPendingSales, (): PendingSale[] => pendingSales.list());
  answerSignedIn(IPC_CHANNELS.checkoutSale, (request): Promise<CheckoutSaleResult> => salePayments.checkout(parsePaymentRequest(request)));
  answerSignedIn(IPC_CHANNELS.reprintLastTicket, (): Promise<ReprintResult> => salePayments.reprintLast());
  answerSignedIn(IPC_CHANNELS.confirmPendingSale, (request): CheckoutSaleResult => salePayments.confirm(parsePaymentRequest(request)));
  answerSignedIn(IPC_CHANNELS.cancelPendingSale, (saleId): void => pendingSales.cancel(parseSaleId(saleId)));
}
