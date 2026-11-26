# Owner panel

Web panel of the business, built with Next.js (App Router), React, and TypeScript in strict mode. The owner signs in through Keycloak, sees the business of the token and the role the core returns, and manages the catalog: search, create, edit, import from CSV and change prices in bulk. The decisions are in [ADR 0044](../../docs/adr/0044-panel-next-con-login-oidc.md) (sign-in) and [ADR 0064](../../docs/adr/0064-pantallas-de-catalogo-del-panel.md) (catalog).

## Run it
1. Start the stack with the realm: `docker compose --profile core up -d` (see [Compose](../../infra/compose/README.md)).
2. Create a user in the realm `pos` (admin console at <http://localhost:8180>) with a password, and set its attribute `tenant_id` to a UUIDv7. The role is not in Keycloak: the core keeps it in `app_user.role` (`owner`, `manager`, or `cashier`, ADR 0042) and returns it in `GET /me`.
3. Copy [`.env.example`](.env.example) to `.env.local` and fill `PANEL_SESSION_SECRET` (`openssl rand -base64 48`).
4. Start the core (`services/core`) if you want to see the connected state, then run `pnpm --filter @pos-saas/web dev` and open <http://localhost:3000>.

## How the sign-in works
| Step | Where | What happens |
| --- | --- | --- |
| 1 | `/auth/login` | Creates a PKCE verifier and a `state`, keeps them in a short-lived sealed cookie, and redirects to Keycloak |
| 2 | Keycloak | The user signs in. The browser never sees a password of the panel |
| 3 | `/auth/callback` | Checks `state`, trades the code and the verifier for tokens on the server, validates the id token, and opens the session |
| 4 | `proxy.ts` | On every protected request: no session goes to the home page, a route with a role rule asks the core for the role (`GET /me`) and shows a no-permission page when the role does not allow it, and a token about to expire is renewed with the refresh token |
| 5 | `/dashboard` | Server Component that calls `GET /me` with the access token |
| 6 | `/auth/logout` | `POST` only. Clears the cookies and sends the browser to the Keycloak end-session endpoint |

The tokens live only inside an encrypted (AES-256-GCM), `HttpOnly`, `SameSite=Lax` cookie, split in chunks when it is large. Scripts cannot read it, and nothing goes to `localStorage`.

## Catalog screens
| Route | Who | What it does | Core endpoint |
| --- | --- | --- | --- |
| `/catalog?q=&page=` | owner, manager | Searches by name or exact code, 50 products per page | `GET /products` |
| `/catalog/new` | owner, manager | Creates a product; only the owner sees the price field | `POST /products` with `Idempotency-Key` |
| `/catalog/{id}` | owner, manager | Edits a product and deletes it; only the owner changes its price | `PATCH /products/{id}`, `PATCH /products/{id}/price`, `DELETE /products/{id}` |
| `/catalog/import` | owner, manager | Checks a CSV file (`dryRun`), shows the report, then loads it | `POST /imports/catalog` |
| `/catalog/price-changes` | owner | Bulk price change by percentage with a preview; a stale preview (409) shows a fresh one | `POST /price-changes` |

Pages read with Server Components and write with Server Actions, so the access token never reaches the browser. Prices and quantities stay as text (`"12.3450"`) from the core to the screen; the panel never turns them into a `number`.

## Invoicing screens
`/invoices/global` (owner and manager, permission `invoice.issue`) issues the global invoice to the general public ([ADR 0079](../../docs/adr/0079-factura-global.md)): pick the periodicity (monthly by default) and a day of the period, check the preview (sales, totals per tax rate, sales left out because they have their own invoice, SAT deadline) and stamp it. Stamping sends the count of the preview; if the sales changed, nothing is stamped and a fresh preview appears. The list below flags a global whose sales were later invoiced on their own, which must be cancelled with motive 04.

## Layout
| Path | Contents |
| --- | --- |
| `src/app/` | Pages and Route Handlers (`auth/login`, `auth/callback`, `auth/logout`), the catalog pages and Server Actions (`catalog/`), shelf labels (`catalog/labels`, which downloads a PDF through `catalog/labels/pdf`), and the owner-only paper catalog review (`catalog/paper`, which sends each photo to the analytics service through `catalog/paper/read` and exports the approved rows as the register's supplier price-list CSV, ADR 0069) |
| `src/proxy.ts` | Session check, role check, and token renewal for every protected route |
| `src/lib/` | Settings, session sealing, cookies, OIDC calls, identity of the token, route rules, and the core client; `catalog/` holds the catalog client, form checks and decimal text helpers |
| `src/components/` | Small presentational components; `catalog/` holds the table, forms, import and price change panels |
| `e2e/` | Playwright tests, the fake identity provider and the in-memory fake core (`fake-core.ts`) they run against |

## Tests
```bash
pnpm --filter @pos-saas/web test       # Vitest: logic and components
pnpm --filter @pos-saas/web typecheck
pnpm --filter @pos-saas/web test:e2e   # Playwright: builds the panel and signs in with a real browser
```

The first time, install the browser with `pnpm --filter @pos-saas/web exec playwright install chromium`.

The Playwright tests do not use Keycloak: they run against `e2e/fake-oidc.ts`, a small server that speaks the OIDC flow (and checks the PKCE verifier like Keycloak does), answers `/me`, and serves the catalog endpoints from memory (`e2e/fake-core.ts`). A change to a catalog contract of the core must update `fake-core.ts` in the same PR. It keeps CI fast and free of a one-minute container start. The real realm is covered by the Testcontainers tests of the core and by the manual check above.
