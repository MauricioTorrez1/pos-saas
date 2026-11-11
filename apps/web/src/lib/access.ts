import type { AppRole } from './identity';

interface RouteRule {
  prefix: string;
  roles: readonly AppRole[];
}

/**
 * Routes that need a role. A path that matches no rule needs only a valid session.
 * Catalog and settings arrive in F0-21; the rules are here so they are born protected.
 */
const ROUTE_RULES: readonly RouteRule[] = [
  { prefix: '/catalog', roles: ['owner', 'manager'] },
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
