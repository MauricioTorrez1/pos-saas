/** Longest pause between two characters of a scan. A fast typist needs about twice as long. */
export const MAX_SCAN_KEY_GAP_MS = 50;

/** Shortest code that counts as a scan, so two quick key presses are not mistaken for one. */
export const MIN_SCAN_LENGTH = 4;

/**
 * Tells a barcode scanner from a person. A scanner acts as a keyboard, so the only difference is speed: it sends every
 * character of a code in a single burst.
 */
export class ScanDetector {
  #characters = 0;
  #lastAtMs: number | null = null;
  #isBurst = true;

  /**
   * Notes one typed character.
   *
   * @param atMs when the key went down. `KeyboardEvent.timeStamp` is the moment the key was pressed, so a busy screen
   * does not make a person look like a scanner.
   */
  recordCharacter(atMs: number): void {
    if (this.#lastAtMs !== null && atMs - this.#lastAtMs > MAX_SCAN_KEY_GAP_MS) {
      this.#isBurst = false;
    }
    this.#lastAtMs = atMs;
    this.#characters += 1;
  }

  /** Notes an edit, such as Backspace. A scanner never corrects itself. */
  recordEdit(): void {
    this.#isBurst = false;
  }

  /**
   * Answers for the characters noted since the last `reset`.
   *
   * @returns true if they came in one burst, long enough to be a code
   */
  isScan(): boolean {
    return this.#isBurst && this.#characters >= MIN_SCAN_LENGTH;
  }

  /** Forgets everything, once the text was used or cleared. */
  reset(): void {
    this.#characters = 0;
    this.#lastAtMs = null;
    this.#isBurst = true;
  }
}
