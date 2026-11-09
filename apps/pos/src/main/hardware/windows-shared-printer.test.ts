import { describe, expect, it } from 'vitest';

import { DeviceError } from './device-error';
import { WindowsSharedPrinter } from './windows-shared-printer';

const SHARE = '\\\\localhost\\TM-T20';

describe('WindowsSharedPrinter', () => {
  it('sends the bytes of a job, untouched, to the shared printer', async () => {
    const written: { path: string; bytes: number[] }[] = [];
    const printer = new WindowsSharedPrinter(SHARE, async (path, bytes) => {
      written.push({ path, bytes: [...bytes] });
    });

    await printer.print(Uint8Array.from([0x1b, 0x40, 0xa4, 0x0a]));

    expect(written).toEqual([{ path: SHARE, bytes: [0x1b, 0x40, 0xa4, 0x0a] }]);
  });

  it('turns a failed write into a device error that names the printer, so the sale can go on', async () => {
    const printer = new WindowsSharedPrinter(SHARE, async () => {
      throw new Error('ENOENT: the network path was not found');
    });

    const failure = await printer.print(Uint8Array.from([1])).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DeviceError);
    expect((failure as DeviceError).device).toBe('printer');
    expect((failure as DeviceError).message).toContain(SHARE);
  });

  it.each([[''], ['TM-T20'], ['C:\\tickets\\out.bin'], ['\\\\localhost'], ['\\\\localhost\\a\\b'], ['//localhost/TM-T20']])(
    'refuses %j, because it is not the name of a shared printer',
    (path) => {
      expect(() => new WindowsSharedPrinter(path)).toThrow(RangeError);
    },
  );
});
