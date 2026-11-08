import { describe, expect, it } from 'vitest';

import { DEFAULT_APPEARANCE, isAppearance, MAX_BUSINESS_NAME_LENGTH } from './appearance';

describe('isAppearance', () => {
  it('accepts the default appearance', () => {
    expect(isAppearance(DEFAULT_APPEARANCE)).toBe(true);
  });

  it('accepts a name of the longest allowed length', () => {
    expect(isAppearance({ ...DEFAULT_APPEARANCE, businessName: 'x'.repeat(MAX_BUSINESS_NAME_LENGTH) })).toBe(true);
  });

  it.each([
    ['nothing', null],
    ['a text', 'yellow'],
    ['a name that is too long', { ...DEFAULT_APPEARANCE, businessName: 'x'.repeat(MAX_BUSINESS_NAME_LENGTH + 1) }],
    ['a name that is not text', { ...DEFAULT_APPEARANCE, businessName: 7 }],
    ['an unknown color', { ...DEFAULT_APPEARANCE, accent: 'pink' }],
    ['an unknown size', { ...DEFAULT_APPEARANCE, textSize: 'tiny' }],
    ['an unknown theme', { ...DEFAULT_APPEARANCE, theme: 'neon' }],
  ])('rejects %s', (_description, value) => {
    expect(isAppearance(value)).toBe(false);
  });
});
