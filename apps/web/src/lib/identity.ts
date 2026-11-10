import { decodeJwt } from 'jose';

/** Roles of the business (RF-008). F0-14 creates them in the realm; the panel only reads them. */
export const APP_ROLES = ['owner', 'cashier', 'storekeeper', 'technician'] as const;

/** One of the roles of {@link APP_ROLES}. */
export type AppRole = (typeof APP_ROLES)[number];

/** Who the token says the user is, reduced to what the panel needs. No name and no email on purpose. */
export interface Identity {
  /** Business of the user, or `null` when the user has no `tenant_id` yet (the core answers 403). */
  tenantId: string | null;
  /** Known roles of the user. Keycloak's own default roles are dropped. */
  roles: AppRole[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isAppRole(value: unknown): value is AppRole {
  return (APP_ROLES as readonly unknown[]).includes(value);
}

/**
 * Reads the business and the roles from an access token.
 *
 * The signature is not checked here: the token comes straight from the token endpoint over a back
 * channel, and the core validates it again on every call. This only feeds the screen.
 *
 * @param accessToken - Compact JWT issued by Keycloak.
 * @returns The business and roles; empty values when the claims are missing or malformed.
 * @throws If the string is not a decodable JWT.
 */
export function extractIdentity(accessToken: string): Identity {
  const claims = decodeJwt(accessToken);
  const tenantClaim = claims.tenant_id;
  const tenantId = typeof tenantClaim === 'string' && UUID_PATTERN.test(tenantClaim) ? tenantClaim : null;
  const realmAccess = claims.realm_access as { roles?: unknown } | undefined;
  const rawRoles = Array.isArray(realmAccess?.roles) ? realmAccess.roles : [];
  return { tenantId, roles: rawRoles.filter(isAppRole) };
}

/** Spanish label of a role, for the screen. */
export const ROLE_LABELS: Record<AppRole, string> = {
  owner: 'Dueño',
  cashier: 'Cajero',
  storekeeper: 'Almacenista',
  technician: 'Técnico',
};
