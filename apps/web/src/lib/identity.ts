import { decodeJwt } from 'jose';

/** Roles of the business (RF-008): the same three as `app_user.role` in the core (ADR 0042). */
export const APP_ROLES = ['owner', 'manager', 'cashier'] as const;

/** One of the roles of {@link APP_ROLES}. */
export type AppRole = (typeof APP_ROLES)[number];

/**
 * Turns the role text of `GET /me` into a role.
 *
 * @param value - Any value found in the response of the core.
 * @returns The role, or `null` when the value is missing or not one of the known roles.
 */
export function parseRole(value: unknown): AppRole | null {
  return (APP_ROLES as readonly unknown[]).includes(value) ? (value as AppRole) : null;
}

/** Who the token says the user is, reduced to what the panel shows. No name and no email on purpose. */
export interface Identity {
  /** Business of the user, or `null` when the user has no `tenant_id` yet (the core answers 403). */
  tenantId: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads the business from an access token. The role is not here: the core owns it and returns it in `GET /me`.
 *
 * The signature is not checked: the token comes straight from the token endpoint over a back
 * channel, and the core validates it again on every call. This only feeds the screen.
 *
 * @param accessToken - Compact JWT issued by Keycloak.
 * @returns The business; `null` when the claim is missing or malformed.
 * @throws If the string is not a decodable JWT.
 */
export function extractIdentity(accessToken: string): Identity {
  const tenantClaim = decodeJwt(accessToken).tenant_id;
  return { tenantId: typeof tenantClaim === 'string' && UUID_PATTERN.test(tenantClaim) ? tenantClaim : null };
}

/** Spanish label of a role, for the screen. */
export const ROLE_LABELS: Record<AppRole, string> = {
  owner: 'Dueño',
  cashier: 'Cajero',
  manager: 'Encargado',
};
