import { describe, expect, it } from 'vitest';
import { extractIdentity, parseRole } from './identity';
import { TENANT_ID, fakeAccessToken } from './test-support';

describe('extractIdentity', () => {
  it('reads the tenant', async () => {
    expect(extractIdentity(await fakeAccessToken())).toEqual({ tenantId: TENANT_ID });
  });

  it('ignores the roles of the token: the core owns the role', async () => {
    const token = await fakeAccessToken({ realm_access: { roles: ['owner'] } });

    expect(extractIdentity(token)).toEqual({ tenantId: TENANT_ID });
  });

  it('returns no tenant when the claim is missing', async () => {
    expect(extractIdentity(await fakeAccessToken({ tenant_id: undefined })).tenantId).toBeNull();
  });

  it('returns no tenant when the claim is not a UUID', async () => {
    expect(extractIdentity(await fakeAccessToken({ tenant_id: 'acme' })).tenantId).toBeNull();
  });

  it('throws on a string that is not a JWT', () => {
    expect(() => extractIdentity('not-a-token')).toThrow();
  });
});

describe('parseRole', () => {
  it('accepts the three roles of the core', () => {
    expect(['owner', 'manager', 'cashier'].map(parseRole)).toEqual(['owner', 'manager', 'cashier']);
  });

  it('returns null for anything else', () => {
    expect([null, undefined, 'admin', 'Owner', 7].map(parseRole)).toEqual([null, null, null, null, null]);
  });
});
