import { BrowserWindow, type WebContents } from 'electron';

import { isTrustedUrl } from './trusted-url';

/**
 * Opens the register window and loads the screen into it.
 *
 * The screen runs without Node: it is isolated from the preload script and sandboxed by the
 * operating system, and it can only reach the main process through the preload bridge.
 *
 * @param rendererEntry address of the register screen
 * @param preloadPath path of the built preload script
 * @returns once the screen has loaded
 */
export async function openMainWindow(rendererEntry: string, preloadPath: string): Promise<void> {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    autoHideMenuBar: true,
    backgroundColor: '#f5f5f4',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  keepOnRegisterScreen(window.webContents, rendererEntry);
  await window.loadURL(rendererEntry);
}

/** The bridge must never be offered to a foreign page, so the window cannot leave the register screen. */
function keepOnRegisterScreen(contents: WebContents, rendererEntry: string): void {
  contents.on('will-navigate', (event) => {
    if (!isTrustedUrl(event.url, rendererEntry)) {
      event.preventDefault();
    }
  });
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
}
