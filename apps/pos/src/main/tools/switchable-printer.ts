import type { PrinterProvider } from '../hardware/printer-provider';
import { WindowsSharedPrinter } from '../hardware/windows-shared-printer';

/**
 * The ticket printer the owner chose in the settings. It is looked up on every job, so a printer set while the
 * register is open works on the next ticket, without a restart. With no printer set, the jobs go to the fallback,
 * which keeps them in memory: a missing printer never stops a sale.
 */
export class SwitchablePrinter implements PrinterProvider {
  readonly #share: () => string;
  readonly #fallback: PrinterProvider;
  readonly #open: (share: string) => PrinterProvider;

  /**
   * @param share reads the path of the shared printer, or an empty text when there is none
   * @param fallback where the jobs go while no printer is set
   * @param open builds the printer of a path; tests pass a fake
   */
  constructor(share: () => string, fallback: PrinterProvider, open: (share: string) => PrinterProvider = (path) => new WindowsSharedPrinter(path)) {
    this.#share = share;
    this.#fallback = fallback;
    this.#open = open;
  }

  /** @returns whether a real printer is set */
  isConfigured(): boolean {
    return this.#share() !== '';
  }

  /**
   * Prints one job on the printer that is set right now.
   *
   * @param job raw ESC/POS bytes
   * @throws DeviceError if the printer is missing, offline, or out of paper
   */
  async print(job: Uint8Array): Promise<void> {
    const share = this.#share();
    await (share === '' ? this.#fallback : this.#open(share)).print(job);
  }
}
