import { EscPosBuilder } from '../checkout/ticket/escpos';
import type { CashDrawer } from './cash-drawer';
import type { PrinterProvider } from './printer-provider';

/**
 * The cash drawer that hangs from the ticket printer. It has no connection of its own: the printer receives the pulse
 * command as a job, so if the printer is off or out of paper the drawer does not open either.
 */
export class PrinterCashDrawer implements CashDrawer {
  readonly #printer: PrinterProvider;

  /** @param printer the printer the drawer is plugged into */
  constructor(printer: PrinterProvider) {
    this.#printer = printer;
  }

  /**
   * Opens the drawer.
   *
   * @returns once the printer accepted the command
   * @throws DeviceError if the printer did not take the job
   */
  async open(): Promise<void> {
    await this.#printer.print(new EscPosBuilder().initialize().openDrawer().toBytes());
  }
}
