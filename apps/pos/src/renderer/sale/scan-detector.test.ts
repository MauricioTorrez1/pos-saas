import { beforeEach, describe, expect, it } from 'vitest';

import { MAX_SCAN_KEY_GAP_MS, MIN_SCAN_LENGTH, ScanDetector } from './scan-detector';

let detector: ScanDetector;

beforeEach(() => {
  detector = new ScanDetector();
});

function typeAtGaps(gapMs: number, characters: number): void {
  for (let index = 0; index < characters; index += 1) {
    detector.recordCharacter(1_000 + index * gapMs);
  }
}

describe('ScanDetector', () => {
  it('recognizes a burst of characters as a scan', () => {
    typeAtGaps(8, 13);

    expect(detector.isScan()).toBe(true);
  });

  it('accepts a slow scanner right at the limit', () => {
    typeAtGaps(MAX_SCAN_KEY_GAP_MS, 13);

    expect(detector.isScan()).toBe(true);
  });

  it('recognizes a person typing', () => {
    typeAtGaps(MAX_SCAN_KEY_GAP_MS + 1, 13);

    expect(detector.isScan()).toBe(false);
  });

  it('does not treat a few quick keys as a scan', () => {
    typeAtGaps(5, MIN_SCAN_LENGTH - 1);

    expect(detector.isScan()).toBe(false);
  });

  it('is not fooled by one pause in the middle of a burst', () => {
    detector.recordCharacter(0);
    detector.recordCharacter(5);
    detector.recordCharacter(500);
    detector.recordCharacter(505);

    expect(detector.isScan()).toBe(false);
  });

  it('does not treat corrected text as a scan', () => {
    typeAtGaps(5, 13);
    detector.recordEdit();

    expect(detector.isScan()).toBe(false);
  });

  it('starts over after a reset', () => {
    typeAtGaps(200, 13);
    detector.reset();
    typeAtGaps(5, 13);

    expect(detector.isScan()).toBe(true);
  });

  it('reports no scan when nothing was typed', () => {
    expect(detector.isScan()).toBe(false);
  });
});
