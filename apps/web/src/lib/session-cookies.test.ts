import { describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE,
  clearSession,
  cookieOptions,
  readSession,
  writeSession,
  type CookieOptions,
  type CookieWriter,
} from './session-cookies';
import type { Session } from './session';

const SECRET = 'a-test-secret-with-more-than-32-characters';
const BASE_URL = new URL('http://localhost:3000');

class FakeCookies implements CookieWriter {
  readonly store = new Map<string, { value: string; options?: CookieOptions }>();

  get(name: string) {
    return this.store.get(name);
  }
  set(name: string, value: string, options: CookieOptions) {
    this.store.set(name, { value, options });
  }
  delete(name: string) {
    this.store.delete(name);
  }
}

function sessionWithBigTokens(): Session {
  // Random-looking text does not compress, so the sealed value really is as large as the tokens.
  const blob = (length: number) =>
    Array.from({ length }, () => Math.floor(Math.random() * 36).toString(36)).join('');
  return {
    accessToken: blob(4000),
    refreshToken: blob(2000),
    idToken: blob(2000),
    accessExpiresAt: 1,
    tenantId: null,
    roles: [],
  };
}

describe('session cookies', () => {
  it('stores a small session in one HttpOnly cookie', async () => {
    const cookies = new FakeCookies();
    const session: Session = { ...sessionWithBigTokens(), accessToken: 'a', refreshToken: 'r', idToken: 'i' };

    await writeSession(cookies, session, SECRET, BASE_URL);

    expect([...cookies.store.keys()]).toEqual([SESSION_COOKIE]);
    expect(cookies.get(SESSION_COOKIE)?.options).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: false });
    expect(await readSession(cookies, SECRET)).toEqual(session);
  });

  it('splits a large session into chunks that stay under the browser limit and reads it back', async () => {
    const cookies = new FakeCookies();
    const session = sessionWithBigTokens();

    await writeSession(cookies, session, SECRET, BASE_URL);

    expect(cookies.store.size).toBeGreaterThan(1);
    for (const { value } of cookies.store.values()) {
      expect(value.length).toBeLessThanOrEqual(3600);
    }
    expect(await readSession(cookies, SECRET)).toEqual(session);
  });

  it('removes the leftover chunks of an older, larger session when it writes a smaller one', async () => {
    const cookies = new FakeCookies();
    await writeSession(cookies, sessionWithBigTokens(), SECRET, BASE_URL);
    const small: Session = { ...sessionWithBigTokens(), accessToken: 'a', refreshToken: 'r', idToken: 'i' };

    await writeSession(cookies, small, SECRET, BASE_URL);

    expect(cookies.store.size).toBe(1);
    expect(await readSession(cookies, SECRET)).toEqual(small);
  });

  it('returns null when there is no cookie, and after clearing', async () => {
    const cookies = new FakeCookies();
    expect(await readSession(cookies, SECRET)).toBeNull();

    await writeSession(cookies, sessionWithBigTokens(), SECRET, BASE_URL);
    clearSession(cookies);

    expect(cookies.store.size).toBe(0);
    expect(await readSession(cookies, SECRET)).toBeNull();
  });

  it('turns on Secure for an https panel', () => {
    expect(cookieOptions(new URL('https://panel.example.com'), 60).secure).toBe(true);
  });
});
