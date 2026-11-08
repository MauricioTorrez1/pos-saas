/** Records calls across several fakes in the order they happened, so a test can check a whole sale. */
export class CallLog {
  readonly #entries: string[] = [];

  /**
   * Adds a call at the end.
   *
   * @param entry the device and method, such as `printer.print`
   */
  record(entry: string): void {
    this.#entries.push(entry);
  }

  /** Every call so far, oldest first. */
  get entries(): readonly string[] {
    return [...this.#entries];
  }
}
