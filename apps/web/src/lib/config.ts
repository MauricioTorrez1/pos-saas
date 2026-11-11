/** Settings of the panel, read once from environment variables (see `.env.example`). */
export interface PanelConfig {
  /** Issuer URL of the Keycloak realm, for example `http://localhost:8180/realms/pos`. */
  issuerUrl: URL;
  /** OIDC client id. It is a public client: no secret exists (ADR 0039). */
  clientId: string;
  /** Public address of the panel. It builds the redirect and logout URLs. */
  baseUrl: URL;
  /** Address of the Spring Boot core, called only from the server. */
  coreApiUrl: URL;
  /** Secret that encrypts the session cookie. */
  sessionSecret: string;
}

/** Thrown when a required setting is missing or malformed. The message never includes a value. */
export class ConfigError extends Error {}

const MIN_SECRET_LENGTH = 32;

function requireUrl(env: NodeJS.ProcessEnv, name: string): URL {
  const raw = env[name];
  if (!raw) {
    throw new ConfigError(`${name} is not set`);
  }
  try {
    return new URL(raw);
  } catch {
    throw new ConfigError(`${name} is not a valid URL`);
  }
}

/**
 * Reads and validates the panel settings.
 *
 * @param env - Source of the variables. Defaults to `process.env`; tests pass their own object.
 * @returns The validated settings.
 * @throws {ConfigError} If a variable is missing, malformed, or the session secret is too short.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): PanelConfig {
  const sessionSecret = env.PANEL_SESSION_SECRET ?? '';
  if (sessionSecret.length < MIN_SECRET_LENGTH) {
    throw new ConfigError(`PANEL_SESSION_SECRET must have at least ${MIN_SECRET_LENGTH} characters`);
  }
  return {
    issuerUrl: requireUrl(env, 'PANEL_OIDC_ISSUER_URL'),
    clientId: env.PANEL_OIDC_CLIENT_ID || 'pos-panel',
    baseUrl: requireUrl(env, 'PANEL_BASE_URL'),
    coreApiUrl: requireUrl(env, 'PANEL_CORE_API_URL'),
    sessionSecret,
  };
}
