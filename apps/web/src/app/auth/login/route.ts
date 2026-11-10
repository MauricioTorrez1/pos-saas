import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { startLogin } from '@/lib/oidc';
import { LOGIN_COOKIE, LOGIN_MAX_AGE_SECONDS, cookieOptions } from '@/lib/session-cookies';
import { seal } from '@/lib/session';
import { getConfig } from '@/lib/server';

export const dynamic = 'force-dynamic';

/** Sends the browser to Keycloak, keeping the state and the PKCE verifier in a short-lived sealed cookie. */
export async function GET(): Promise<NextResponse> {
  const config = getConfig();
  try {
    const { url, transaction } = await startLogin(config);
    const jar = await cookies();
    jar.set(
      LOGIN_COOKIE,
      await seal(transaction, config.sessionSecret, LOGIN_MAX_AGE_SECONDS),
      cookieOptions(config.baseUrl, LOGIN_MAX_AGE_SECONDS),
    );
    return NextResponse.redirect(url);
  } catch (error) {
    console.error('Login could not start', error instanceof Error ? error.message : error);
    return NextResponse.redirect(new URL('/?error=idp_unavailable', config.baseUrl));
  }
}
