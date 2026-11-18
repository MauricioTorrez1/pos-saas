import { ipcMain, type BrowserWindow } from 'electron';

import { EXIT_ANSWERS, EXIT_CHANNELS, type ExitAnswer } from '../../shared/exit-api';
import type { ExitGuard } from './exit-guard';

function isExitAnswer(value: unknown): value is ExitAnswer {
  return typeof value === 'string' && (EXIT_ANSWERS as readonly string[]).includes(value);
}

/**
 * Puts the guard between the register window and every way of closing it: the X, Alt+F4 and quitting from the menu all
 * end in the `close` event, so this is the one place that stops them (ADR 0070).
 *
 * @param window the register window
 * @param guard decides whether the window may close
 */
export function guardWindowClose(window: BrowserWindow, guard: ExitGuard): void {
  window.on('close', (event) => {
    if (!guard.onCloseRequested()) {
      event.preventDefault();
    }
  });
  // Windows shutting down must never wait for a cashier, so the guard only records it.
  window.on('session-end', () => guard.onSessionEnd());
  window.webContents.on('render-process-gone', () => guard.onScreenGone());
  ipcMain.handle(EXIT_CHANNELS.answer, (event, answer: unknown) => {
    if (event.sender !== window.webContents || !isExitAnswer(answer)) {
      throw new TypeError('Expected an answer to the request to close');
    }
    guard.onAnswer(answer);
  });
}
