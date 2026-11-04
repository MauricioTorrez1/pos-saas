import { app, ipcMain } from 'electron';

import { IPC_CHANNELS, type AppInfo } from '../shared/pos-api';
import { assertTrustedSender } from './trusted-url';

/**
 * Registers what the main process answers to the screen.
 *
 * @param rendererEntry address the register screen was loaded from
 */
export function registerIpcHandlers(rendererEntry: string): void {
  ipcMain.handle(IPC_CHANNELS.getAppInfo, (event): AppInfo => {
    assertTrustedSender(event.senderFrame?.url, rendererEntry);
    return { version: app.getVersion() };
  });
}
