import { randomBytes } from 'node:crypto';

const BYTE_COUNT = 16;
const TIMESTAMP_BYTES = 6;

/**
 * Creates a UUIDv7: 48 bits of milliseconds followed by random bits, so ids sort by creation time.
 *
 * @param nowMs the moment to stamp, in milliseconds since 1970
 * @returns the id in its usual text form
 */
export function uuidV7(nowMs: number = Date.now()): string {
  const bytes = randomBytes(BYTE_COUNT);
  bytes.writeUIntBE(nowMs, 0, TIMESTAMP_BYTES);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
