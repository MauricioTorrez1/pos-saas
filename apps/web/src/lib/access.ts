import type { AppRole } from './identity';

interface RouteRule {
  prefix: string;
  roles: readonly AppRole[];
}

/**
 * Routes that need a role, the most specific first. A path that matches no rule needs only a valid session.
 * They mirror the permission table of the core (ADR 0042): the manager edits the catalog and imports it, only the
 * owner changes prices in bulk. Hiding a screen is a courtesy; the core still answers 403.
 */
const ROUTE_RULES: readonly RouteRule[] = [
  { prefix: '/catalog/price-changes', roles: ['owner'] },
  // Reading a paper catalog spends money on the Claude API, so only the owner may (ADR 0069).
  { prefix: '/catalog/paper', roles: ['owner'] },
  { prefix: '/catalog', roles: ['owner', 'manager'] },
  // invoice.issue: the owner and the manager (ADR 0080).
  { prefix: '/invoices', roles: ['owner', 'manager'] },
  { prefix: '/settings', roles: ['owner'] },
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Finds the roles a route needs.
 *
 * @param pathname - Path of the request, for example `/catalog/new`.
 * @returns The roles that may open it, or `null` when any signed-in user may.
 */
export function rolesRequiredFor(pathname: string): readonly AppRole[] | null {
  return ROUTE_RULES.find((candidate) => matchesPrefix(pathname, candidate.prefix))?.roles ?? null;
}

/**
 * Decides whether a user may open a route.
 *
 * @param pathname - Path of the request, for example `/catalog/new`.
 * @param role - Role of the user according to the core, or `null` when it has none.
 * @returns `true` if the route needs no role or the user has one of the roles it needs.
 */
export function canAccess(pathname: string, role: AppRole | null): boolean {
  const required = rolesRequiredFor(pathname);
  return required === null || (role !== null && required.includes(role));
}
