import { EncryptJWT, jwtDecrypt } from 'jose';

/** What the panel keeps about a signed-in user. It lives only inside an encrypted, HttpOnly cookie. */
export interface Session {
  accessToken: string;
  refreshToken: string;
  /** Needed to close the session in Keycloak without asking the user again. */
  idToken: string;
  /** Moment the access token expires, in seconds since the epoch. */
  accessExpiresAt: number;
  tenantId: string | null;
}

/** Longest a session cookie lives, whatever Keycloak says. Keycloak's own idle timeout usually ends it first. */
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

/** Seconds before expiry at which the panel asks Keycloak for a new access token. */
export const REFRESH_SKEW_SECONDS = 30;

async function deriveKey(secret: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return new Uint8Array(digest);
}

/**
 * Encrypts a value into a compact JWE (authenticated encryption, AES-256-GCM).
 *
 * @param payload - Any JSON-serializable object.
 * @param secret - Application secret; a 256-bit key is derived from it.
 * @param maxAgeSeconds - Lifetime written inside the token.
 * @returns The sealed string, safe to put in a cookie.
 */
export async function seal<T extends object>(payload: T, secret: string, maxAgeSeconds: number): Promise<string> {
  return new EncryptJWT({ data: payload })
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(`${maxAgeSeconds}s`)
    .encrypt(await deriveKey(secret));
}

/**
 * Decrypts a value sealed with {@link seal}.
 *
 * @param token - The sealed string from the cookie.
 * @param secret - The same secret used to seal it.
 * @returns The original object, or `null` if the token is tampered with, expired, or sealed with another secret.
 */
export async function unseal<T extends object>(token: string, secret: string): Promise<T | null> {
  try {
    const { payload } = await jwtDecrypt(token, await deriveKey(secret));
    return (payload.data as T | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Tells whether the access token expired or is about to.
 *
 * @param session - Current session.
 * @param nowSeconds - Current time in seconds since the epoch.
 */
export function needsRefresh(session: Session, nowSeconds: number): boolean {
  return session.accessExpiresAt - REFRESH_SKEW_SECONDS <= nowSeconds;
}
