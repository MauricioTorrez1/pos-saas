/**
 * A tiny stand-in for Keycloak and for the core, used only by the Playwright tests.
 *
 * It speaks enough OpenID Connect for the panel: discovery, authorization code with PKCE (it checks
 * the verifier, like Keycloak), refresh tokens, RP-initiated logout, and signed JWTs. It also serves
 * `GET /me` like the core. The tests steer it through `POST /__control` and read what happened from
 * `GET /__stats`. The real realm is covered by the manual check in apps/web/README.md.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { SignJWT, exportJWK, generateKeyPair, jwtVerify } from 'jose';

const PORT = Number(process.env.FAKE_OIDC_PORT ?? 4017);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ISSUER = `${ORIGIN}/realms/pos`;
const OIDC = `${ISSUER}/protocol/openid-connect`;
const TENANT_ID = '0192f3a4-7b1c-7e2d-8a3f-5c9d1e2b4a60';

type Persona = 'owner' | 'manager' | 'cashier' | 'norole' | 'notenant';

interface Control {
  persona: Persona;
  refresh: 'ok' | 'fail';
  /** Lifetime of the tokens that a refresh returns. */
  accessTtl: number;
  /** Lifetime of the tokens of a first login. */
  loginTtl: number;
  coreStatus: number | null;
}

const defaults = (): Control => ({ persona: 'owner', refresh: 'ok', accessTtl: 300, loginTtl: 300, coreStatus: null });

let control = defaults();
let stats = { logins: 0, refreshes: 0, logouts: 0, pkceChecks: 0 };
const codes = new Map<string, { challenge: string; clientId: string }>();
const refreshTokens = new Set<string>();

const { publicKey, privateKey } = await generateKeyPair('RS256');
const jwk = { ...(await exportJWK(publicKey)), kid: 'fake-key', alg: 'RS256', use: 'sig' };

/** The role the fake core returns in /me, like app_user.role. The tokens carry no roles. */
function roleOf(persona: Persona): string | null {
  return persona === 'owner' || persona === 'manager' || persona === 'cashier' ? persona : null;
}

function claimsFor(persona: Persona): Record<string, unknown> {
  return persona === 'notenant' ? {} : { tenant_id: TENANT_ID };
}

function sign(claims: Record<string, unknown>, audience: string, ttlSeconds: number): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'fake-key' })
    .setIssuer(ISSUER)
    .setSubject('fake-user')
    .setAudience(audience)
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(privateKey);
}

async function issueTokens(clientId: string, ttl: number) {
  const refreshToken = randomUUID();
  refreshTokens.add(refreshToken);
  return {
    access_token: await sign({ ...claimsFor(control.persona), azp: clientId }, 'pos-core', ttl),
    id_token: await sign({ azp: clientId }, clientId, ttl),
    refresh_token: refreshToken,
    token_type: 'Bearer',
    expires_in: ttl,
  };
}

function send(response: ServerResponse, status: number, body?: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString();
}

async function handleToken(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const form = new URLSearchParams(await readBody(request));
  const clientId = form.get('client_id') ?? '';
  if (form.get('grant_type') === 'authorization_code') {
    const entry = codes.get(form.get('code') ?? '');
    codes.delete(form.get('code') ?? '');
    const verifier = form.get('code_verifier') ?? '';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    if (!entry || entry.clientId !== clientId || entry.challenge !== challenge) {
      return send(response, 400, { error: 'invalid_grant' });
    }
    stats.pkceChecks += 1;
    stats.logins += 1;
    return send(response, 200, await issueTokens(clientId, control.loginTtl));
  }
  if (form.get('grant_type') === 'refresh_token') {
    if (control.refresh === 'fail' || !refreshTokens.delete(form.get('refresh_token') ?? '')) {
      return send(response, 400, { error: 'invalid_grant' });
    }
    stats.refreshes += 1;
    return send(response, 200, await issueTokens(clientId, control.accessTtl));
  }
  return send(response, 400, { error: 'unsupported_grant_type' });
}

async function handleMe(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (control.coreStatus) {
    return send(response, control.coreStatus);
  }
  const bearer = request.headers.authorization?.replace(/^Bearer /, '');
  try {
    const { payload } = await jwtVerify(bearer ?? '', publicKey, { issuer: ISSUER, audience: 'pos-core' });
    if (typeof payload.tenant_id !== 'string') {
      return send(response, 403);
    }
    return send(response, 200, { subject: payload.sub, tenantId: payload.tenant_id, role: roleOf(control.persona) });
  } catch {
    return send(response, 401);
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', ORIGIN);
  try {
    if (url.pathname === '/realms/pos/.well-known/openid-configuration') {
      return send(response, 200, {
        issuer: ISSUER,
        authorization_endpoint: `${OIDC}/auth`,
        token_endpoint: `${OIDC}/token`,
        jwks_uri: `${OIDC}/certs`,
        end_session_endpoint: `${OIDC}/logout`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      });
    }
    if (url.pathname === `/realms/pos/protocol/openid-connect/certs`) {
      return send(response, 200, { keys: [jwk] });
    }
    if (url.pathname === `/realms/pos/protocol/openid-connect/auth`) {
      const redirect = new URL(url.searchParams.get('redirect_uri') ?? '');
      const code = randomUUID();
      codes.set(code, {
        challenge: url.searchParams.get('code_challenge') ?? '',
        clientId: url.searchParams.get('client_id') ?? '',
      });
      redirect.searchParams.set('code', code);
      redirect.searchParams.set('state', url.searchParams.get('state') ?? '');
      redirect.searchParams.set('iss', ISSUER);
      response.writeHead(302, { Location: redirect.toString() });
      return void response.end();
    }
    if (url.pathname === `/realms/pos/protocol/openid-connect/token` && request.method === 'POST') {
      return await handleToken(request, response);
    }
    if (url.pathname === `/realms/pos/protocol/openid-connect/logout`) {
      stats.logouts += 1;
      refreshTokens.clear();
      response.writeHead(302, { Location: url.searchParams.get('post_logout_redirect_uri') ?? '/' });
      return void response.end();
    }
    if (url.pathname === '/me') {
      return await handleMe(request, response);
    }
    if (url.pathname === '/__control' && request.method === 'POST') {
      const patch = JSON.parse(await readBody(request)) as Partial<Control> & { reset?: boolean };
      control = patch.reset ? defaults() : { ...control, ...patch };
      if (patch.reset) {
        stats = { logins: 0, refreshes: 0, logouts: 0, pkceChecks: 0 };
        refreshTokens.clear();
      }
      return send(response, 200, control);
    }
    if (url.pathname === '/__stats') {
      return send(response, 200, stats);
    }
    return send(response, 404);
  } catch (error) {
    console.error(error);
    return send(response, 500);
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`Fake OIDC provider on ${ORIGIN}`));
