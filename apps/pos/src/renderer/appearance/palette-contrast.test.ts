import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ACCENTS } from '../../shared/appearance';

const STYLESHEET = readFileSync(join(import.meta.dirname, '..', 'styles.css'), 'utf8');
const MIN_READABLE_CONTRAST = 4.5;

/** Reads a color token from one block of the stylesheet. */
function tokenIn(blockSelector: string, token: string): string {
  const blockStart = STYLESHEET.indexOf(`${blockSelector} {`);
  expect(blockStart, `block ${blockSelector}`).toBeGreaterThanOrEqual(0);
  const block = STYLESHEET.slice(blockStart, STYLESHEET.indexOf('}', blockStart));
  const value = new RegExp(`${token}:\\s*(#[0-9a-f]{6});`).exec(block)?.[1];
  expect(value, `${token} in ${blockSelector}`).toBeDefined();
  return value!;
}

/** Relative luminance as WCAG defines it. */
function luminance(hex: string): number {
  const [red, green, blue] = [1, 3, 5].map((start) => {
    const channel = Number.parseInt(hex.slice(start, start + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrast(first: string, second: string): number {
  const [lighter, darker] = [luminance(first), luminance(second)].sort((a, b) => b - a) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

describe('palette', () => {
  it.each(ACCENTS)('keeps the text on %s readable', (accent) => {
    const paint = tokenIn(':root', `--paint-${accent}`);
    const textOnPaint = tokenIn(':root', `--paint-${accent}-on`);

    expect(contrast(paint, textOnPaint)).toBeGreaterThanOrEqual(MIN_READABLE_CONTRAST);
  });

  it.each([
    ['light', ':root'],
    ['dark', ":root[data-theme='dark']"],
  ])('keeps the text of the %s theme readable', (_theme, block) => {
    const ground = tokenIn(block, '--ground');
    const surface = tokenIn(block, '--surface');

    expect(contrast(tokenIn(block, '--ink'), surface)).toBeGreaterThanOrEqual(MIN_READABLE_CONTRAST);
    expect(contrast(tokenIn(block, '--ink-soft'), surface)).toBeGreaterThanOrEqual(MIN_READABLE_CONTRAST);
    expect(contrast(tokenIn(block, '--ink-soft'), ground)).toBeGreaterThanOrEqual(MIN_READABLE_CONTRAST);
    expect(contrast(tokenIn(block, '--alert'), tokenIn(block, '--alert-surface'))).toBeGreaterThanOrEqual(MIN_READABLE_CONTRAST);
  });
});
