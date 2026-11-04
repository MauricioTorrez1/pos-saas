/** Channels between the preload bridge and the main process. */
export const IPC_CHANNELS = {
  getAppInfo: 'app:get-info',
} as const;

/** Facts about the running app that the screen may show. */
export interface AppInfo {
  readonly version: string;
}

/** Everything the screen can ask of the main process. */
export interface PosApi {
  /**
   * Reads the facts about the running app.
   *
   * @returns the app version, as the main process knows it
   */
  getAppInfo(): Promise<AppInfo>;
}
