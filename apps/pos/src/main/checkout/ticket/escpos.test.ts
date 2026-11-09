import { describe, expect, it } from 'vitest';

import { EscPosBuilder } from './escpos';

function bytesOf(build: (builder: EscPosBuilder) => EscPosBuilder): number[] {
  return [...build(new EscPosBuilder()).toBytes()];
}

describe('EscPosBuilder', () => {
  it('starts a job by resetting the printer and choosing the code page of Spanish', () => {
    expect(bytesOf((builder) => builder.initialize())).toEqual([0x1b, 0x40, 0x1b, 0x74, 19]);
  });

  it('encodes the accents and the inverted marks of Spanish in code page 858', () => {
    expect(bytesOf((builder) => builder.line('áéíóú ñÑ ü ¿¡'))).toEqual([
      0xa0, 0x82, 0xa1, 0xa2, 0xa3, 0x20, 0xa4, 0xa5, 0x20, 0x81, 0x20, 0xa8, 0xad, 0x0a,
    ]);
  });

  it('prints a question mark for a character the printer cannot draw, never a broken byte', () => {
    expect(bytesOf((builder) => builder.line('a€漢b'))).toEqual([0x61, 0x3f, 0x3f, 0x62, 0x0a]);
  });

  it('sets the alignment and goes back to the left', () => {
    expect(bytesOf((builder) => builder.align('center'))).toEqual([0x1b, 0x61, 1]);
    expect(bytesOf((builder) => builder.align('right'))).toEqual([0x1b, 0x61, 2]);
    expect(bytesOf((builder) => builder.align('left'))).toEqual([0x1b, 0x61, 0]);
  });

  it('turns bold on and off', () => {
    expect(bytesOf((builder) => builder.bold(true))).toEqual([0x1b, 0x45, 1]);
    expect(bytesOf((builder) => builder.bold(false))).toEqual([0x1b, 0x45, 0]);
  });

  it('doubles the size of the text and puts it back', () => {
    expect(bytesOf((builder) => builder.doubleSize(true))).toEqual([0x1d, 0x21, 0x11]);
    expect(bytesOf((builder) => builder.doubleSize(false))).toEqual([0x1d, 0x21, 0x00]);
  });

  it('feeds paper and cuts it', () => {
    expect(bytesOf((builder) => builder.feed(3))).toEqual([0x1b, 0x64, 3]);
    expect(bytesOf((builder) => builder.cut())).toEqual([0x1d, 0x56, 0x42, 0]);
  });

  it('refuses a feed that does not fit in one byte', () => {
    expect(() => new EscPosBuilder().feed(256)).toThrow(RangeError);
    expect(() => new EscPosBuilder().feed(-1)).toThrow(RangeError);
  });

  it('does not let text carry a command: control characters become spaces', () => {
    expect(bytesOf((builder) => builder.line('a\x1bb\x00c'))).toEqual([0x61, 0x20, 0x62, 0x20, 0x63, 0x0a]);
  });

  it('keeps the bytes in the order they were written, and gives a copy each time', () => {
    const builder = new EscPosBuilder().line('A').line('B');
    const first = builder.toBytes();
    first[0] = 0;

    expect([...builder.toBytes()]).toEqual([0x41, 0x0a, 0x42, 0x0a]);
  });
});
