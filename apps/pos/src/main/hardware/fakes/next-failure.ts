/** Lets a test make the next call of a fake fail once, the way a real device sometimes does. */
export class NextFailure {
  #error: Error | undefined;

  /**
   * Makes the next call fail.
   *
   * @param error what that call throws
   */
  arm(error: Error): void {
    this.#error = error;
  }

  /** Throws the armed error, if there is one, and disarms it so the call after that succeeds. */
  throwIfArmed(): void {
    const error = this.#error;
    this.#error = undefined;
    if (error) {
      throw error;
    }
  }
}
