import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { buildLogoutUrl } from '@/lib/oidc';
import { clearSession, readSession } from '@/lib/session-cookies';
import { getConfig } from '@/lib/server';

export const dynamic = 'force-dynamic';

/**
 * Ends the session here and in Keycloak. It answers POST only: a link or an image on another site
 * could otherwise sign the user out with a GET.
 */
export async function POST(): Promise<NextResponse> {
  const config = getConfig();
  const jar = await cookies();
  const session = await readSession(jar, config.sessionSecret);
  clearSession(jar);

  const home = new URL('/', config.baseUrl);
  if (!session) {
    return NextResponse.redirect(home, 303);
  }
  try {
    return NextResponse.redirect(await buildLogoutUrl(config, session.idToken), 303);
  } catch (error) {
    // Keycloak is down: the local session is already gone, and its own idle timeout closes the rest.
    console.error('Logout in Keycloak failed', error instanceof Error ? error.message : error);
    return NextResponse.redirect(home, 303);
  }
}
