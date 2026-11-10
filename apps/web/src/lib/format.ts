/**
 * Shortens a tenant UUID for the screen, keeping the start and the end: `0192f3a4…c9d1`.
 *
 * @param tenantId - Full UUID.
 * @returns The shortened text; the input unchanged if it is already short.
 */
export function shortTenantId(tenantId: string): string {
  if (tenantId.length <= 14) {
    return tenantId;
  }
  return `${tenantId.slice(0, 8)}…${tenantId.slice(-4)}`;
}
