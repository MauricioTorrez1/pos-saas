import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** A PIN is four to eight digits: short enough to type with one hand at the counter. */
const PIN_PATTERN = /^[0-9]{4,8}$/;

const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELISM = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const ALGORITHM = 'scrypt';

/**
 * Tells whether a text can be a PIN.
 *
 * @param pin what was typed
 * @returns true for four to eight ASCII digits
 */
export function isValidPin(pin: string): boolean {
  return PIN_PATTERN.test(pin);
}

/**
 * Hashes a PIN to keep it on disk. It uses scrypt, which needs a lot of memory to guess, and a salt of its own, so two
 * people with the same PIN have different hashes. The settings travel with the hash, so they can be raised later.
 *
 * @param pin four to eight digits
 * @returns text such as `scrypt$16384$8$1$<salt>$<hash>`, which is all `verifyPin` needs
 * @throws RangeError if the PIN is not four to eight digits
 */
export function hashPin(pin: string): string {
  if (!isValidPin(pin)) {
    throw new RangeError('A PIN is four to eight digits');
  }
  const salt = randomBytes(SALT_BYTES);
  const key = scryptSync(pin, salt, KEY_BYTES, { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELISM });
  return [ALGORITHM, SCRYPT_COST, SCRYPT_BLOCK_SIZE, SCRYPT_PARALLELISM, salt.toString('base64'), key.toString('base64')].join('$');
}

/**
 * Checks a PIN against a stored hash, comparing in constant time so the time it takes does not say how many digits were
 * right.
 *
 * @param pin what was typed
 * @param stored a value from `hashPin`
 * @returns true if they match. A damaged or unknown stored value never matches.
 */
export function verifyPin(pin: string, stored: string): boolean {
  const [algorithm, cost, blockSize, parallelism, salt, hash] = stored.split('$');
  if (algorithm !== ALGORITHM || salt === undefined || hash === undefined || !isValidPin(pin)) {
    return false;
  }
  try {
    const expected = Buffer.from(hash, 'base64');
    const actual = scryptSync(pin, Buffer.from(salt, 'base64'), expected.length, {
      N: Number(cost),
      r: Number(blockSize),
      p: Number(parallelism),
    });
    return expected.length > 0 && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
