import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { app } from 'electron';

import { registerIpcHandlers } from './ipc-handlers';
import { openMainWindow } from './main-window';

const PRELOAD_PATH = join(import.meta.dirname, '../preload/index.cjs');
const RENDERER_HTML_PATH = join(import.meta.dirname, '../renderer/index.html');

/** Uses the dev server while developing. A packaged app ignores the variable, so nothing can point it at another page. */
function resolveRendererEntry(): string {
  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  return !app.isPackaged && devServerUrl ? devServerUrl : pathToFileURL(RENDERER_HTML_PATH).href;
}

async function start(): Promise<void> {
  await app.whenReady();
  const rendererEntry = resolveRendererEntry();
  registerIpcHandlers(rendererEntry);
  await openMainWindow(rendererEntry, PRELOAD_PATH);
}

start().catch((error: unknown) => {
  console.error('The register failed to start', error);
  app.exit(1);
});
