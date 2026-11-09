import { writeFile } from 'node:fs/promises';

import { DeviceError } from './device-error';
import type { PrinterProvider } from './printer-provider';

/** `\\computer\printer`: the name Windows gives a shared printer. */
const SHARED_PRINTER_PATH = /^\\\\[^\\/]+\\[^\\/]+$/;

type WriteBytes = (path: string, bytes: Uint8Array) => Promise<void>;

/**
 * Prints on a thermal printer that Windows shares, such as the Epson TM-T20 installed on the same computer. Windows
 * accepts the raw bytes written to `\\localhost\<share name>`, the same as `copy /b ticket.bin \\localhost\TM-T20`, so no
 * native driver is needed.
 */
export class WindowsSharedPrinter implements PrinterProvider {
  readonly #path: string;
  readonly #write: WriteBytes;

  /**
   * @param sharePath the shared printer, such as `\\localhost\TM-T20`
   * @param write writes the bytes to the path. Tests pass their own, and the default writes to the file system.
   * @throws RangeError if the path is not the name of a shared printer
   */
  constructor(sharePath: string, write: WriteBytes = writeFile) {
    if (!SHARED_PRINTER_PATH.test(sharePath)) {
      throw new RangeError(`Expected a shared printer such as \\\\localhost\\TM-T20, got "${sharePath}"`);
    }
    this.#path = sharePath;
    this.#write = write;
  }

  /**
   * Prints one job.
   *
   * @param job raw ESC/POS bytes
   * @returns once Windows accepted the job
   * @throws DeviceError if Windows cannot reach the printer
   */
  async print(job: Uint8Array): Promise<void> {
    try {
      await this.#write(this.#path, job);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new DeviceError('printer', `No se pudo imprimir en ${this.#path}: ${reason}`, { cause: error });
    }
  }
}
