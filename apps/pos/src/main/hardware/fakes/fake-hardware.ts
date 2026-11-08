import type { RegisterHardware } from '../register-hardware';
import { CallLog } from './call-log';
import { RecordingCashDrawer } from './recording-cash-drawer';
import { RecordingPrinter } from './recording-printer';
import { ScriptedCardTerminal } from './scripted-card-terminal';
import { ScriptedScale } from './scripted-scale';

/** Every device faked, with the concrete fakes exposed so a test can script them and read what they recorded. */
export interface FakeHardware extends RegisterHardware {
  readonly printer: RecordingPrinter;
  readonly cashDrawer: RecordingCashDrawer;
  readonly scale: ScriptedScale;
  readonly cardTerminal: ScriptedCardTerminal;
  /** Every call to any of the four devices, in order. */
  readonly log: CallLog;
}

/**
 * Builds a register without any real device, for tests and for developing without the store's equipment.
 *
 * @param log where every device records its calls. Pass one to mix in calls from other fakes.
 * @returns the four fakes, sharing that log
 */
export function createFakeHardware(log: CallLog = new CallLog()): FakeHardware {
  return {
    printer: new RecordingPrinter(log),
    cashDrawer: new RecordingCashDrawer(log),
    scale: new ScriptedScale(log),
    cardTerminal: new ScriptedCardTerminal(log),
    log,
  };
}
