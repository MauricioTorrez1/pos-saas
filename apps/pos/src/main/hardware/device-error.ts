/** The devices the register talks to. */
export type DeviceName = 'printer' | 'cashDrawer' | 'scale' | 'cardTerminal';

/** A device did not do what it was asked: it is missing, offline, out of paper, or did not answer. */
export class DeviceError extends Error {
  readonly device: DeviceName;

  /**
   * @param device the device that failed
   * @param message what happened, in words support can act on
   * @param options the original error, if there is one
   */
  constructor(device: DeviceName, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DeviceError';
    this.device = device;
  }
}
