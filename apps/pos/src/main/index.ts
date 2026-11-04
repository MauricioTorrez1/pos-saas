import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { app, dialog } from 'electron';

import { registerIpcHandlers } from './ipc-handlers';
import { LocalStore } from './local-store/local-store';
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
 */
function openLocalStore(): void {
  try {
    const store = LocalStore.open({
      path: join(app.getPath('userData'), DATABASE_FILE_NAME),
      appVersion: app.getVersion(),
    });
    app.once('will-quit', () => store.close());
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
  openLocalStore();
  const rendererEntry = resolveRendererEntry();
  registerIpcHandlers(rendererEntry);
  await openMainWindow(rendererEntry, PRELOAD_PATH);
}

start().catch((error: unknown) => {
  console.error('The register failed to start', error);
  app.exit(1);
});
