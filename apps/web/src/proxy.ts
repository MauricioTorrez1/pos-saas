import { NextResponse, type NextRequest } from 'next/server';
import { canAccess, rolesRequiredFor } from '@/lib/access';
import { fetchMe } from '@/lib/core-client';
import { loadConfig } from '@/lib/config';
import { refreshSession } from '@/lib/oidc';
import { needsRefresh } from '@/lib/session';
import {
  clearSession,
  readSession,
  writeSession,
  type CookieOptions,
  type CookieWriter,
} from '@/lib/session-cookies';

/** Collects the cookie changes of a renewal so they can be applied to whichever response is chosen. */
class PendingCookies implements CookieWriter {
  readonly sets = new Map<string, { value: string; options: CookieOptions }>();
  readonly deletes = new Set<string>();

  get(name: string): { value: string } | undefined {
    const pending = this.sets.get(name);
    return pending ? { value: pending.value } : undefined;
  }

  set(name: string, value: string, options: CookieOptions): void {
    this.deletes.delete(name);
    this.sets.set(name, { value, options });
  }

  delete(name: string): void {
    this.sets.delete(name);
    this.deletes.add(name);
  }
}

function redirectHome(request: NextRequest, error?: string): NextResponse {
  const url = new URL('/', request.url);
  if (error) {
    url.searchParams.set('error', error);
  }
  return NextResponse.redirect(url);
}

/** Applies the cookies of a renewal, if there was one, to the response that goes to the browser. */
function withCookies(response: NextResponse, pending: PendingCookies): NextResponse {
  for (const [name, { value, options }] of pending.sets) {
    response.cookies.set(name, value, options);
  }
  for (const name of pending.deletes) {
    response.cookies.delete(name);
  }
  return response;
}

/**
 * Builds the headers that go on to the page or the Server Action, with the renewed session cookie in place of the
 * old one. Without this, a POST (a Server Action) renewed here would still carry the old token, and the action could
 * not renew it again because the refresh token was already spent.
 */
function forwardedHeaders(request: NextRequest, pending: PendingCookies): Headers {
  const jar = new Map(request.cookies.getAll().map((cookie) => [cookie.name, cookie.value] as const));
  for (const name of pending.deletes) {
    jar.delete(name);
  }
  for (const [name, { value }] of pending.sets) {
    jar.set(name, value);
  }
  const headers = new Headers(request.headers);
  headers.set('cookie', [...jar].map(([name, value]) => `${name}=${value}`).join('; '));
  return headers;
}

/**
 * Guards every page except the home and `/auth/*`.
 *
 * Without a session the visitor goes to the home page. An access token that is about to expire is
 * renewed here, because only this layer and Route Handlers may set cookies. A route that needs a
 * role asks the core for the role (`GET /me`, from `app_user`, so a role change applies at once); a
 * role the route does not allow, or a core that does not answer, shows the no-permission page.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  const config = loadConfig();
  let session = await readSession(request.cookies, config.sessionSecret);
  if (!session) {
    return redirectHome(request, 'login_required');
  }

  const pending = new PendingCookies();
  let renewed = false;
  if (needsRefresh(session, Math.floor(Date.now() / 1000))) {
    try {
      session = await refreshSession(config, session);
      await writeSession(pending, session, config.sessionSecret, config.baseUrl);
      renewed = true;
    } catch {
      // Keycloak closed the session (idle timeout, logout elsewhere) or rejected the refresh token.
      const response = redirectHome(request, 'session_expired');
      clearSession(response.cookies);
      return response;
    }
  }

  // The page must see the renewed cookie, and a Server Component only sees what the browser sends.
  // So a GET is answered with a redirect to itself that carries the new cookies; the checks run on
  // the second request. If the new token is still inside the margin (a very short lifetime),
  // redirecting again would loop, so it just goes on.
  if (renewed && request.method === 'GET' && !needsRefresh(session, Math.floor(Date.now() / 1000))) {
    const url = new URL(`${request.nextUrl.pathname}${request.nextUrl.search}`, config.baseUrl);
    return withCookies(NextResponse.redirect(url), pending);
  }

  const pathname = request.nextUrl.pathname;
  if (rolesRequiredFor(pathname) !== null) {
    const me = await fetchMe(config, session.accessToken);
    if (me.status === 'unauthorized') {
      const response = redirectHome(request, 'session_expired');
      clearSession(response.cookies);
      return response;
    }
    if (!canAccess(pathname, me.status === 'ok' ? me.role : null)) {
      return withCookies(NextResponse.rewrite(new URL('/forbidden', request.url)), pending);
    }
  }
  const next = renewed ? NextResponse.next({ request: { headers: forwardedHeaders(request, pending) } }) : NextResponse.next();
  return withCookies(next, pending);
}

export const config = {
  // Everything except the home page, the auth routes, the no-permission page, and Next's own files.
  matcher: ['/((?!$|auth/|forbidden|_next/|favicon\\.ico|icon\\.).+)'],
};
