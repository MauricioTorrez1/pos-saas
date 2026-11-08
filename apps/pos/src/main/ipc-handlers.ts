import { app, ipcMain } from 'electron';

import { isAppearance } from '../shared/appearance';
import { IPC_CHANNELS, MAX_LOOKUP_TEXT_LENGTH, type AppInfo, type CatalogProduct } from '../shared/pos-api';
import type { AppearanceStore } from './local-store/appearance-store';
import type { ProductCatalog } from './local-store/product-catalog';
import { assertTrustedSender } from './trusted-url';

const SEARCH_RESULT_LIMIT = 20;

/** What the handlers answer with. */
export interface IpcServices {
  readonly catalog: ProductCatalog;
  readonly appearance: AppearanceStore;
}

/** Whatever crosses the bridge is checked again here, because the database must not depend on the screen being right. */
function requireLookupText(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_LOOKUP_TEXT_LENGTH) {
    throw new TypeError(`Expected a text of at most ${MAX_LOOKUP_TEXT_LENGTH} characters`);
  }
  return value;
}

/**
 * Registers what the main process answers to the screen. Every channel refuses calls from any other page.
 *
 * @param rendererEntry address the register screen was loaded from
 * @param services the local data the answers come from
 */
export function registerIpcHandlers(rendererEntry: string, { catalog, appearance }: IpcServices): void {
  const answerScreen = <Result>(channel: string, respond: (argument: unknown) => Result): void => {
    ipcMain.handle(channel, (event, argument: unknown) => {
      assertTrustedSender(event.senderFrame?.url, rendererEntry);
      return respond(argument);
    });
  };

  answerScreen(IPC_CHANNELS.getAppInfo, (): AppInfo => ({ version: app.getVersion() }));
  answerScreen(IPC_CHANNELS.findProductByCode, (code): CatalogProduct | null => catalog.findByCode(requireLookupText(code)));
  answerScreen(IPC_CHANNELS.searchProducts, (text): CatalogProduct[] =>
    catalog.search(requireLookupText(text), SEARCH_RESULT_LIMIT),
  );
  answerScreen(IPC_CHANNELS.getAppearance, () => appearance.read());
  answerScreen(IPC_CHANNELS.saveAppearance, (value): void => {
    if (!isAppearance(value)) {
      throw new TypeError('Expected a complete appearance with allowed values');
    }
    appearance.save(value);
  });
}
