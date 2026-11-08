import { describe, expect, it } from 'vitest';

import { DeviceError } from '../device-error';
import { createFakeHardware } from './fake-hardware';
import { RecordingCashDrawer } from './recording-cash-drawer';
import { RecordingPrinter } from './recording-printer';
import { ScriptedCardTerminal } from './scripted-card-terminal';
import { ScriptedScale } from './scripted-scale';

/** ESC @ resets an ESC/POS printer. */
const INITIALIZE_PRINTER = [0x1b, 0x40];
/** GS V 1 makes a partial cut. */
const PARTIAL_CUT = [0x1d, 0x56, 0x01];

describe('RecordingPrinter', () => {
  it('keeps the bytes of each job in order, and joins them as the paper would show them', async () => {
    const printer = new RecordingPrinter();

    await printer.print(Uint8Array.from([...INITIALIZE_PRINTER, 0x48, 0x6f, 0x6c, 0x61]));
    await printer.print(Uint8Array.from(PARTIAL_CUT));

    expect(printer.jobs).toEqual([
      Uint8Array.from([...INITIALIZE_PRINTER, 0x48, 0x6f, 0x6c, 0x61]),
      Uint8Array.from(PARTIAL_CUT),
    ]);
    expect(printer.printedBytes()).toEqual(Uint8Array.from([...INITIALIZE_PRINTER, 0x48, 0x6f, 0x6c, 0x61, ...PARTIAL_CUT]));
  });

  it('keeps what was printed even if the caller reuses its buffer', async () => {
    const printer = new RecordingPrinter();
    const buffer = Uint8Array.from(INITIALIZE_PRINTER);

    await printer.print(buffer);
    buffer.fill(0);

    expect(printer.printedBytes()).toEqual(Uint8Array.from(INITIALIZE_PRINTER));
  });

  it('fails one job when told to, without recording it as printed', async () => {
    const printer = new RecordingPrinter();
    printer.failNextWith();

    await expect(printer.print(Uint8Array.from(INITIALIZE_PRINTER))).rejects.toThrow(DeviceError);
    await printer.print(Uint8Array.from(PARTIAL_CUT));

    expect(printer.jobs).toEqual([Uint8Array.from(PARTIAL_CUT)]);
  });
});

describe('RecordingCashDrawer', () => {
  it('counts each opening, but not a failed one', async () => {
    const cashDrawer = new RecordingCashDrawer();

    await cashDrawer.open();
    cashDrawer.failNextWith();
    await expect(cashDrawer.open()).rejects.toMatchObject({ device: 'cashDrawer' });

    expect(cashDrawer.openCount).toBe(1);
  });
});

describe('ScriptedScale', () => {
  it('returns the placed weights in order, one per reading', async () => {
    const scale = new ScriptedScale();
    scale.placeOnScale(1250, 3275);

    expect(await scale.readWeightMilli()).toBe(1250);
    expect(await scale.readWeightMilli()).toBe(3275);
  });

  it('fails like a real scale when nothing was placed on it', async () => {
    await expect(new ScriptedScale().readWeightMilli()).rejects.toMatchObject({ device: 'scale' });
  });

  it('refuses a weight with decimals, because weights travel as thousandths', () => {
    expect(() => new ScriptedScale().placeOnScale(1.25)).toThrow(RangeError);
  });
});

describe('ScriptedCardTerminal', () => {
  const request = { saleId: 'sale-1', idempotencyKey: 'attempt-1', amountCents: 4094 };

  it('approves a charge by default, and keeps no card data', async () => {
    const cardTerminal = new ScriptedCardTerminal();

    expect(await cardTerminal.charge(request)).toEqual({ status: 'approved', authorizationCode: '000001' });
    expect(cardTerminal.charges).toEqual([request]);
  });

  it('answers what the test scripted', async () => {
    const cardTerminal = new ScriptedCardTerminal();
    cardTerminal.willRespond({ status: 'declined', reason: 'Fondos insuficientes' });

    expect(await cardTerminal.charge(request)).toEqual({ status: 'declined', reason: 'Fondos insuficientes' });
  });

  it('charges once when the same attempt is retried', async () => {
    const cardTerminal = new ScriptedCardTerminal();

    const first = await cardTerminal.charge(request);
    const retry = await cardTerminal.charge(request);

    expect(retry).toEqual(first);
    expect(cardTerminal.charges).toHaveLength(1);
  });

  it('refuses an amount with decimals, because money travels as cents', async () => {
    await expect(new ScriptedCardTerminal().charge({ ...request, amountCents: 40.94 })).rejects.toThrow(RangeError);
  });

  it('fails before reaching the card when told to', async () => {
    const cardTerminal = new ScriptedCardTerminal();
    cardTerminal.failNextWith();

    await expect(cardTerminal.charge(request)).rejects.toMatchObject({ device: 'cardTerminal' });
    expect(cardTerminal.charges).toEqual([]);
  });
});

describe('createFakeHardware', () => {
  it('records the calls of all four devices in one log, in the order they happened', async () => {
    const hardware = createFakeHardware();
    hardware.scale.placeOnScale(1250);

    await hardware.scale.readWeightMilli();
    await hardware.cardTerminal.charge({ saleId: 'sale-1', idempotencyKey: 'attempt-1', amountCents: 5625 });
    await hardware.cashDrawer.open();
    await hardware.printer.print(Uint8Array.from(INITIALIZE_PRINTER));

    expect(hardware.log.entries).toEqual([
      'scale.readWeightMilli',
      'cardTerminal.charge',
      'cashDrawer.open',
      'printer.print',
    ]);
  });
});
