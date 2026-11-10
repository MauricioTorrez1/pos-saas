import { describe, expect, it } from 'vitest';
import { REFRESH_SKEW_SECONDS, needsRefresh, seal, unseal, type Session } from './session';

const SECRET = 'a-test-secret-with-more-than-32-characters';

const session: Session = {
  accessToken: 'access',
  refreshToken: 'refresh',
  idToken: 'id',
  accessExpiresAt: 1_000_000,
  tenantId: '0192f3a4-7b1c-7e2d-8a3f-5c9d1e2b4a60',
  roles: ['owner'],
};

describe('seal and unseal', () => {
  it('round-trips a session', async () => {
    const sealed = await seal(session, SECRET, 60);

    expect(await unseal<Session>(sealed, SECRET)).toEqual(session);
  });

  it('does not leak the tokens in the cookie value', async () => {
    const sealed = await seal(session, SECRET, 60);

    expect(sealed).not.toContain('access');
    expect(Buffer.from(sealed.split('.')[3] ?? '', 'base64url').toString()).not.toContain('refresh');
  });

  it('returns null with another secret', async () => {
    const sealed = await seal(session, SECRET, 60);

    expect(await unseal<Session>(sealed, 'another-secret-with-more-than-32-chars')).toBeNull();
  });

  it('returns null for a tampered value', async () => {
    const sealed = await seal(session, SECRET, 60);
    const tampered = `${sealed.slice(0, -4)}AAAA`;

    expect(await unseal<Session>(tampered, SECRET)).toBeNull();
  });

  it('returns null for garbage', async () => {
    expect(await unseal<Session>('garbage', SECRET)).toBeNull();
  });
});

describe('needsRefresh', () => {
  it('is false while the token has more than the skew left', () => {
    expect(needsRefresh(session, session.accessExpiresAt - REFRESH_SKEW_SECONDS - 1)).toBe(false);
  });

  it('is true inside the skew window', () => {
    expect(needsRefresh(session, session.accessExpiresAt - REFRESH_SKEW_SECONDS)).toBe(true);
  });

  it('is true once the token expired', () => {
    expect(needsRefresh(session, session.accessExpiresAt + 10)).toBe(true);
  });
});
