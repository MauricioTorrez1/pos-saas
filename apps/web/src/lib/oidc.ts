import * as client from 'openid-client';
import type { PanelConfig } from './config';
import { extractIdentity } from './identity';
import type { Session } from './session';

/** What the panel must remember between leaving for Keycloak and coming back. */
export interface LoginTransaction {
  state: string;
  codeVerifier: string;
}

/** The answer of the token endpoint, reduced to what the panel reads. */
type TokenSet = Awaited<ReturnType<typeof client.authorizationCodeGrant>>;

const DEFAULT_ACCESS_LIFETIME_SECONDS = 300;

let cachedConfiguration: Promise<client.Configuration> | undefined;

/**
 * Discovers the endpoints of the realm once per process (`/.well-known/openid-configuration`).
 *
 * A failed discovery is not cached, so the panel recovers when Keycloak comes back.
 */
async function getConfiguration(config: PanelConfig): Promise<client.Configuration> {
  if (!cachedConfiguration) {
    // Plain HTTP is accepted only for a local Keycloak. Any other issuer must use HTTPS.
    const isLocalHttp = config.issuerUrl.protocol === 'http:';
    cachedConfiguration = client
      .discovery(config.issuerUrl, config.clientId, undefined, client.None(), {
        execute: isLocalHttp ? [client.allowInsecureRequests] : [],
      })
      .catch((error: unknown) => {
        cachedConfiguration = undefined;
        throw error;
      });
  }
  return cachedConfiguration;
}

/** Forgets the discovered endpoints. Tests use it between cases. */
export function resetOidcCache(): void {
  cachedConfiguration = undefined;
}

function redirectUri(config: PanelConfig): string {
  return new URL('/auth/callback', config.baseUrl).toString();
}

/**
 * Starts an authorization code login with PKCE (RFC 7636).
 *
 * @returns The Keycloak URL to send the browser to, and the values to keep until the callback.
 */
export async function startLogin(config: PanelConfig): Promise<{ url: URL; transaction: LoginTransaction }> {
  const configuration = await getConfiguration(config);
  const codeVerifier = client.randomPKCECodeVerifier();
  const state = client.randomState();
  const url = client.buildAuthorizationUrl(configuration, {
    redirect_uri: redirectUri(config),
    scope: 'openid',
    code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state,
  });
  return { url, transaction: { state, codeVerifier } };
}

function toSession(tokens: TokenSet, previous?: Session): Session {
  const idToken = tokens.id_token ?? previous?.idToken;
  const refreshToken = tokens.refresh_token ?? previous?.refreshToken;
  if (!idToken || !refreshToken) {
    throw new Error('The token response has no id token or refresh token');
  }
  const lifetime = tokens.expiresIn() ?? DEFAULT_ACCESS_LIFETIME_SECONDS;
  return {
    accessToken: tokens.access_token,
    refreshToken,
    idToken,
    accessExpiresAt: Math.floor(Date.now() / 1000) + lifetime,
    ...extractIdentity(tokens.access_token),
  };
}

/**
 * Finishes the login: checks `state`, sends the PKCE verifier, and validates the id token.
 *
 * @param callbackUrl - The URL Keycloak redirected the browser to, with `code` and `state`.
 * @param transaction - The values saved by {@link startLogin}.
 * @throws If the state does not match, the code is rejected, or the id token is invalid.
 */
export async function completeLogin(
  config: PanelConfig,
  callbackUrl: URL,
  transaction: LoginTransaction,
): Promise<Session> {
  const configuration = await getConfiguration(config);
  const tokens = await client.authorizationCodeGrant(configuration, callbackUrl, {
    pkceCodeVerifier: transaction.codeVerifier,
    expectedState: transaction.state,
    idTokenExpected: true,
  });
  return toSession(tokens);
}

/**
 * Trades the refresh token for a new access token.
 *
 * @throws If Keycloak rejects the refresh token (the user closed the session, or it idled out).
 */
export async function refreshSession(config: PanelConfig, session: Session): Promise<Session> {
  const configuration = await getConfiguration(config);
  const tokens = await client.refreshTokenGrant(configuration, session.refreshToken);
  return toSession(tokens, session);
}

/**
 * Builds the URL that ends the session in Keycloak (RP-initiated logout) and comes back to the panel.
 *
 * @param idToken - Id token of the session, so Keycloak does not ask for confirmation.
 */
export async function buildLogoutUrl(config: PanelConfig, idToken: string): Promise<URL> {
  const configuration = await getConfiguration(config);
  return client.buildEndSessionUrl(configuration, {
    id_token_hint: idToken,
    post_logout_redirect_uri: new URL('/', config.baseUrl).toString(),
  });
}
