import { SESSION_MAX_AGE_SECONDS, seal, unseal, type Session } from './session';

/** Name of the first (and usually only) cookie that holds the session. */
export const SESSION_COOKIE = 'pos_session';

/** Name of the short-lived cookie that holds the state and the PKCE verifier during a login. */
export const LOGIN_COOKIE = 'pos_login';

/** Seconds a login may take between leaving for Keycloak and coming back. */
export const LOGIN_MAX_AGE_SECONDS = 600;

// Browsers drop a cookie above 4096 bytes. Tokens grow with the roles, so the sealed value is split.
const CHUNK_SIZE = 3600;
const MAX_CHUNKS = 8;

/** The part of the cookie API shared by `next/headers`, `NextRequest` and `NextResponse`. */
export interface CookieReader {
  get(name: string): { value: string } | undefined;
}

/** A cookie store the panel can write to. */
export interface CookieWriter extends CookieReader {
  set(name: string, value: string, options: CookieOptions): unknown;
  delete(name: string): unknown;
}

/** Attributes the panel sets on every cookie. */
export interface CookieOptions {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
}

function chunkName(index: number): string {
  return index === 0 ? SESSION_COOKIE : `${SESSION_COOKIE}.${index}`;
}

/**
 * Builds the attributes of a cookie.
 *
 * HttpOnly keeps scripts away from it (an XSS cannot read tokens). SameSite=Lax still lets the cookie
 * travel on the redirect that comes back from Keycloak, and blocks it on cross-site POSTs.
 *
 * @param baseUrl - Public address of the panel; `https` turns on `Secure`.
 * @param maxAge - Lifetime in seconds.
 */
export function cookieOptions(baseUrl: URL, maxAge: number): CookieOptions {
  return { httpOnly: true, secure: baseUrl.protocol === 'https:', sameSite: 'lax', path: '/', maxAge };
}

/**
 * Reads the session from the cookies of a request.
 *
 * @returns The session, or `null` if there is none or it cannot be decrypted.
 */
export async function readSession(cookies: CookieReader, secret: string): Promise<Session | null> {
  let sealed = '';
  for (let index = 0; index < MAX_CHUNKS; index += 1) {
    const chunk = cookies.get(chunkName(index));
    if (!chunk) {
      break;
    }
    sealed += chunk.value;
  }
  return sealed ? unseal<Session>(sealed, secret) : null;
}

/**
 * Removes every chunk of the session cookie. It deletes by name without looking first, because a
 * response cookie store does not see the cookies that came with the request.
 */
export function clearSession(cookies: CookieWriter): void {
  for (let index = 0; index < MAX_CHUNKS; index += 1) {
    cookies.delete(chunkName(index));
  }
}

/**
 * Writes the session, split into as many cookies as it needs.
 *
 * @throws If the sealed session would need more than {@link MAX_CHUNKS} cookies.
 */
export async function writeSession(
  cookies: CookieWriter,
  session: Session,
  secret: string,
  baseUrl: URL,
): Promise<void> {
  const sealed = await seal(session, secret, SESSION_MAX_AGE_SECONDS);
  const chunks = sealed.match(new RegExp(`.{1,${CHUNK_SIZE}}`, 'g')) ?? [];
  if (chunks.length > MAX_CHUNKS) {
    throw new Error('The session is too large to store in cookies');
  }
  clearSession(cookies);
  const options = cookieOptions(baseUrl, SESSION_MAX_AGE_SECONDS);
  chunks.forEach((chunk, index) => cookies.set(chunkName(index), chunk, options));
}
