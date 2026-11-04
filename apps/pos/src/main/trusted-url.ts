/**
 * Tells whether an address belongs to the register screen.
 *
 * A built screen is a single file, so only that file is trusted. File addresses have no real
 * origin, which is why they compare host and path. A dev server is trusted as a whole origin.
 *
 * @param candidate address to check
 * @param rendererEntry address the register screen was loaded from
 * @returns true only if the address is part of the register screen
 */
export function isTrustedUrl(candidate: string, rendererEntry: string): boolean {
  const target = URL.parse(candidate);
  const entry = URL.parse(rendererEntry);
  if (target === null || entry === null) {
    return false;
  }
  if (entry.protocol === 'file:') {
    return target.protocol === 'file:' && target.host === entry.host && target.pathname === entry.pathname;
  }
  return target.origin === entry.origin;
}

/**
 * Stops a call to the main process that does not come from the register screen.
 *
 * @param senderUrl address of the calling frame, or undefined if the frame is gone
 * @param rendererEntry address the register screen was loaded from
 * @throws Error if the caller is not the register screen
 */
export function assertTrustedSender(senderUrl: string | undefined, rendererEntry: string): void {
  if (senderUrl === undefined || !isTrustedUrl(senderUrl, rendererEntry)) {
    throw new Error(`Blocked a call from an untrusted page: ${senderUrl ?? 'unknown'}`);
  }
}
