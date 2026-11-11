import { cookies } from 'next/headers';
import { loadConfig, type PanelConfig } from './config';
import { readSession } from './session-cookies';
import type { Session } from './session';

let cachedConfig: PanelConfig | undefined;

/** Settings of the panel, validated once per process. Server-side code only. */
export function getConfig(): PanelConfig {
  cachedConfig ??= loadConfig();
  return cachedConfig;
}

/**
 * Reads the session of the current request in a Server Component or Route Handler.
 *
 * @returns The session, or `null` if the user is not signed in.
 */
export async function getSession(): Promise<Session | null> {
  return readSession(await cookies(), getConfig().sessionSecret);
}
