import { describe, expect, it } from 'vitest';

import { uuidV7 } from './uuid-v7';

const UUID_V7_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidV7', () => {
  it('produces the version and variant of a UUIDv7', () => {
    expect(uuidV7()).toMatch(UUID_V7_SHAPE);
  });

  it('stamps the given moment in the first 48 bits', () => {
    expect(uuidV7(0x0190_0000_0001).startsWith('01900000-0001-7')).toBe(true);
  });

  it('sorts ids created at different moments by time', () => {
    const ids = [uuidV7(1_000), uuidV7(2_000), uuidV7(3_000)];

    expect([...ids].sort()).toEqual(ids);
  });

  it('does not repeat ids created in the same millisecond', () => {
    expect(uuidV7(1_000)).not.toBe(uuidV7(1_000));
  });
});
