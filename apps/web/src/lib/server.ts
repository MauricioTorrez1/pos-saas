import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { createCoreApi, type CoreApi } from './catalog/core-api';
import { loadConfig, type PanelConfig } from './config';
import { fetchMe, type MeResult } from './core-client';
import { createInvoicingApi, type InvoicingApi } from './invoicing/invoicing-api';
import { readSession } from './session-cookies';
import type { Session } from './session';

let cachedConfig: PanelConfig | undefined;

/** Settings of the panel, validated once per process. Server-side code only. */
export function getConfig(): PanelConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

/**
 * Reads the session of the current request in a Server Component, Server Action or Route Handler.
 *
 * @returns The session, or `null` if the user is not signed in.
 */
export async function getSession(): Promise<Session | null> {
  return readSession(await cookies(), getConfig().sessionSecret);
}

/**
 * Reads the session or sends the visitor to the home page. For pages and actions behind the proxy, where a missing
 * session means it ended between two requests.
 */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    redirect('/?error=login_required');
  }
  return session;
}

/**
 * Asks the core who the user is, once per request: the layout and the page of the same request share the answer.
 *
 * @returns The answer of `GET /me`.
 */
export const getMe = cache(async (): Promise<MeResult> => {
  const session = await requireSession();
  return fetchMe(getConfig(), session.accessToken);
});

/**
 * A client of the catalog endpoints with the token of this request.
 *
 * @returns The client; it lives only on the server.
 */
export async function getCoreApi(): Promise<CoreApi> {
  const session = await requireSession();
  return createCoreApi(getConfig(), session.accessToken);
}

/**
 * A client of the invoicing endpoints with the token of this request.
 *
 * @returns The client; it lives only on the server.
 */
export async function getInvoicingApi(): Promise<InvoicingApi> {
  const session = await requireSession();
  return createInvoicingApi(getConfig(), session.accessToken);
}
