/** Longest passphrase a person types for the backups. */
export const MAX_PASSPHRASE_LENGTH = 200;

/**
 * Checks the passphrase of the backups that crossed the bridge.
 *
 * @param value whatever the screen sent
 * @returns the passphrase
 * @throws TypeError if it is not an object with a passphrase of at most 200 characters
 */
export function parsePassphraseRequest(value: unknown): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Expected a request with a passphrase');
  }
  const { passphrase } = value as Record<string, unknown>;
  if (typeof passphrase !== 'string' || passphrase.length > MAX_PASSPHRASE_LENGTH) {
    throw new TypeError(`Expected a passphrase of at most ${MAX_PASSPHRASE_LENGTH} characters`);
  }
  return passphrase;
}