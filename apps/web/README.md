# Owner panel

Web panel of the business, built with Next.js (App Router), React, and TypeScript in strict mode. For now the owner signs in through Keycloak, sees the business and the role of the token, and the panel proves the chain by calling `GET /me` on the core. Catalog screens arrive in F0-21. The decisions are in [ADR 0044](../../docs/adr/0044-panel-next-con-login-oidc.md).

## Run it
1. Start the stack with the realm: `docker compose --profile core up -d` (see [Compose](../../infra/compose/README.md)).
2. Create a user in the realm `pos` (admin console at <http://localhost:8180>) with a password, and set its attribute `tenant_id` to a UUIDv7. Optionally create the realm roles `owner`, `cashier`, `storekeeper`, or `technician` and give one to the user.
3. Copy [`.env.example`](.env.example) to `.env.local` and fill `PANEL_SESSION_SECRET` (`openssl rand -base64 48`).
4. Start the core (`services/core`) if you want to see the connected state, then run `pnpm --filter @pos-saas/web dev` and open <http://localhost:3000>.

## How the sign-in works
| Step | Where | What happens |
| --- | --- | --- |
| 1 | `/auth/login` | Creates a PKCE verifier and a `state`, keeps them in a short-lived sealed cookie, and redirects to Keycloak |
| 2 | Keycloak | The user signs in. The browser never sees a password of the panel |
| 3 | `/auth/callback` | Checks `state`, trades the code and the verifier for tokens on the server, validates the id token, and opens the session |
| 4 | `proxy.ts` | On every protected request: no session goes to the home page, a role the route does not allow sees a no-permission page, and a token about to expire is renewed with the refresh token |
| 5 | `/dashboard` | Server Component that calls `GET /me` with the access token |
| 6 | `/auth/logout` | `POST` only. Clears the cookies and sends the browser to the Keycloak end-session endpoint |

The tokens live only inside an encrypted (AES-256-GCM), `HttpOnly`, `SameSite=Lax` cookie, split in chunks when it is large. Scripts cannot read it, and nothing goes to `localStorage`.

## Layout
| Path | Contents |
| --- | --- |
| `src/app/` | Pages and Route Handlers (`auth/login`, `auth/callback`, `auth/logout`) |
| `src/proxy.ts` | Session check, role check, and token renewal for every protected route |
| `src/lib/` | Settings, session sealing, cookies, OIDC calls, identity of the token, route rules, and the core client |
| `src/components/` | Small presentational components |
| `e2e/` | Playwright tests and the fake identity provider they run against |

## Tests
```bash
pnpm --filter @pos-saas/web test       # Vitest: logic and components
pnpm --filter @pos-saas/web typecheck
pnpm --filter @pos-saas/web test:e2e   # Playwright: builds the panel and signs in with a real browser
```

The first time, install the browser with `pnpm --filter @pos-saas/web exec playwright install chromium`.

The Playwright tests do not use Keycloak: they run against `e2e/fake-oidc.ts`, a small server that speaks the OIDC flow (and checks the PKCE verifier like Keycloak does) and also answers `/me`. It keeps CI fast and free of a one-minute container start. The real realm is covered by the Testcontainers tests of the core and by the manual check above.
