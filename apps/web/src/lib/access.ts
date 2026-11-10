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
  { prefix: '/catalog', roles: ['owner', 'storekeeper'] },
  { prefix: '/settings', roles: ['owner'] },
];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * Decides whether a user may open a route.
 *
 * @param pathname - Path of the request, for example `/catalog/new`.
 * @param roles - Roles of the user.
 * @returns `true` if the route needs no role or the user has one of the roles it needs.
 */
export function canAccess(pathname: string, roles: readonly AppRole[]): boolean {
  const rule = ROUTE_RULES.find((candidate) => matchesPrefix(pathname, candidate.prefix));
  if (!rule) {
    return true;
  }
  return rule.roles.some((role) => roles.includes(role));
}
