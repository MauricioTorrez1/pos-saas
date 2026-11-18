import { describe, expect, it } from 'vitest';
import { uuidv7 } from './uuid7';

describe('uuidv7', () => {
  it('has the version 7 and the RFC 9562 variant', () => {
    expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('starts with the milliseconds, so ids sort by time', () => {
    const id = uuidv7(0x0192f3a47b1c);

    expect(id.startsWith('0192f3a4-7b1c-7')).toBe(true);
    expect(uuidv7(1_000) < uuidv7(2_000)).toBe(true);
  });

  it('does not repeat', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(5)));

    expect(ids.size).toBe(1000);
  });
});
