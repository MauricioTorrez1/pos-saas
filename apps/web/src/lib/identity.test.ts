import { describe, expect, it } from 'vitest';
import { extractIdentity } from './identity';
import { TENANT_ID, fakeAccessToken } from './test-support';

describe('extractIdentity', () => {
  it('reads the tenant and the known roles', async () => {
    const token = await fakeAccessToken({ realm_access: { roles: ['owner', 'cashier'] } });

    expect(extractIdentity(token)).toEqual({ tenantId: TENANT_ID, roles: ['owner', 'cashier'] });
  });

  it('drops the default roles of Keycloak', async () => {
    const token = await fakeAccessToken({
      realm_access: { roles: ['offline_access', 'uma_authorization', 'default-roles-pos', 'manager'] },
    });

    expect(extractIdentity(token).roles).toEqual(['manager']);
  });

  it('returns no tenant when the claim is missing', async () => {
    const token = await fakeAccessToken({ tenant_id: undefined });

    expect(extractIdentity(token).tenantId).toBeNull();
  });

  it('returns no tenant when the claim is not a UUID', async () => {
    const token = await fakeAccessToken({ tenant_id: 'acme' });

    expect(extractIdentity(token).tenantId).toBeNull();
  });

  it('returns no roles when realm_access is missing or malformed', async () => {
    expect(extractIdentity(await fakeAccessToken({ realm_access: undefined })).roles).toEqual([]);
    expect(extractIdentity(await fakeAccessToken({ realm_access: { roles: 'owner' } })).roles).toEqual([]);
  });

  it('throws on a string that is not a JWT', () => {
    expect(() => extractIdentity('not-a-token')).toThrow();
  });
});
