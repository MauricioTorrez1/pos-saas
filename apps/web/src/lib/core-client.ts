import type { PanelConfig } from './config';
import { parseRole, type AppRole } from './identity';

/** Outcome of asking the core who the token belongs to (`GET /me`, ADR 0039 and 0042). */
export type MeResult =
  | { status: 'ok'; subject: string; tenantId: string; role: AppRole | null }
  | { status: 'unauthorized' }
  | { status: 'forbidden' }
  | { status: 'unavailable' };

const REQUEST_TIMEOUT_MS = 5000;

/**
 * Calls `GET /me` on the core with the access token as a bearer.
 *
 * It must run on the server only: the token never reaches the browser. Network errors and 5xx
 * answers become `unavailable` so the screen can explain them instead of failing.
 *
 * @param config - Panel settings.
 * @param accessToken - Access token of the session.
 * @param fetcher - HTTP client; tests pass a fake.
 */
export async function fetchMe(
  config: PanelConfig,
  accessToken: string,
  fetcher: typeof fetch = fetch,
): Promise<MeResult> {
  try {
    const response = await fetcher(new URL('/me', config.coreApiUrl), {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (response.status === 401) {
      return { status: 'unauthorized' };
    }
    if (response.status === 403) {
      return { status: 'forbidden' };
    }
    if (!response.ok) {
      return { status: 'unavailable' };
    }
    const body = (await response.json()) as { subject?: unknown; tenantId?: unknown; role?: unknown };
    if (typeof body.subject !== 'string' || typeof body.tenantId !== 'string') {
      return { status: 'unavailable' };
    }
    return { status: 'ok', subject: body.subject, tenantId: body.tenantId, role: parseRole(body.role) };
  } catch {
    return { status: 'unavailable' };
  }
}
