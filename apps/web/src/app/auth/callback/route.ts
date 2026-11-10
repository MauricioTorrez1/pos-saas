import { cookies } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { completeLogin, type LoginTransaction } from '@/lib/oidc';
import { LOGIN_COOKIE, writeSession } from '@/lib/session-cookies';
import { unseal } from '@/lib/session';
import { getConfig } from '@/lib/server';

export const dynamic = 'force-dynamic';

function backHome(baseUrl: URL, error: string): NextResponse {
  return NextResponse.redirect(new URL(`/?error=${error}`, baseUrl));
}

/** Receives the code from Keycloak, trades it for tokens on the server, and opens the session. */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const config = getConfig();
  const jar = await cookies();
  const sealedTransaction = jar.get(LOGIN_COOKIE)?.value;
  jar.delete(LOGIN_COOKIE);

  if (request.nextUrl.searchParams.has('error')) {
    // The user cancelled, or Keycloak refused. The error text is not echoed to the screen.
    return backHome(config.baseUrl, 'login_cancelled');
  }
  const transaction = sealedTransaction
    ? await unseal<LoginTransaction>(sealedTransaction, config.sessionSecret)
    : null;
  if (!transaction) {
    return backHome(config.baseUrl, 'login_expired');
  }

  try {
    // Behind a proxy the request URL may carry an internal host, so the public one is rebuilt.
    const callbackUrl = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, config.baseUrl);
    const session = await completeLogin(config, callbackUrl, transaction);
    await writeSession(jar, session, config.sessionSecret, config.baseUrl);
    return NextResponse.redirect(new URL('/dashboard', config.baseUrl));
  } catch (error) {
    console.error('Login failed', error instanceof Error ? error.message : error);
    return backHome(config.baseUrl, 'login_failed');
  }
}
