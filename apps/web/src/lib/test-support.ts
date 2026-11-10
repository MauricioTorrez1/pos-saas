import { SignJWT } from 'jose';

/** Tenant used by the tests. A UUIDv7-shaped value. */
export const TENANT_ID = '0192f3a4-7b1c-7e2d-8a3f-5c9d1e2b4a60';

/** Creates an unsigned-in-spirit access token with the claims the panel reads. Signature is irrelevant for the panel. */
export async function fakeAccessToken(claims: Record<string, unknown> = {}): Promise<string> {
  return new SignJWT({ tenant_id: TENANT_ID, realm_access: { roles: ['owner'] }, ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('user-1')
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode('test-only-key-test-only-key-test-only'));
}
