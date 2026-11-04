import type { PosApi } from '../shared/pos-api';

declare global {
  interface Window {
    /** Bridge from the preload script: the screen's only way to reach the main process. */
    readonly pos: PosApi;
  }
}
