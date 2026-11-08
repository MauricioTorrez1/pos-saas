/**
 * Sends ready-made ESC/POS bytes to the ticket printer. It knows nothing about sales: whoever calls it
 * builds the bytes, so the same printer serves tickets, reprints, and the drawer command.
 */
export interface PrinterProvider {
  /**
   * Prints one job.
   *
   * @param job raw ESC/POS bytes, sent as a single job so that no other job can interleave with it
   * @returns once the printer accepted the job
   * @throws DeviceError if the printer is missing, offline, or out of paper
   */
  print(job: Uint8Array): Promise<void>;
}
