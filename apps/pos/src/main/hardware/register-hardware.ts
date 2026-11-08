import type { CardTerminal } from './card-terminal';
import type { CashDrawer } from './cash-drawer';
import type { PrinterProvider } from './printer-provider';
import type { ScaleProvider } from './scale-provider';

/**
 * Every device the register uses. Code that needs a device receives it through this type, so the main
 * process decides in a single place whether it gets the real one or a fake.
 */
export interface RegisterHardware {
  readonly printer: PrinterProvider;
  readonly cashDrawer: CashDrawer;
  readonly scale: ScaleProvider;
  readonly cardTerminal: CardTerminal;
}
