import { describe, expect, it } from 'vitest';

import { DeviceError } from './device-error';
import { createFakeHardware } from './fakes/fake-hardware';
import { PrinterCashDrawer } from './printer-cash-drawer';

describe('PrinterCashDrawer', () => {
  it('opens the drawer by sending the pulse command to the printer as its own job', async () => {
    const { printer } = createFakeHardware();

    await new PrinterCashDrawer(printer).open();

    expect(printer.jobs.map((job) => [...job])).toEqual([[0x1b, 0x40, 0x1b, 0x74, 19, 0x1b, 0x70, 0, 25, 250]]);
  });

  it('does not open when the printer fails, and says which device failed', async () => {
    const { printer } = createFakeHardware();
    printer.failNextWith();

    const failure = await new PrinterCashDrawer(printer).open().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DeviceError);
    expect(printer.jobs).toEqual([]);
  });
});
