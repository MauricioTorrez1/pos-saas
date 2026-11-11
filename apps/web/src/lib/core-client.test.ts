import { describe, expect, it, vi } from 'vitest';
import type { PanelConfig } from './config';
import { fetchMe } from './core-client';

const config = { coreApiUrl: new URL('http://core.test:8080') } as PanelConfig;

function respond(status: number, body?: unknown): typeof fetch {
  return vi.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status })) as typeof fetch;
}

describe('fetchMe', () => {
  it('sends the access token as a bearer to /me', async () => {
    const fetcher = respond(200, { subject: 'user-1', tenantId: 'tenant-1', role: 'manager' });

    const result = await fetchMe(config, 'the-token', fetcher);

    expect(result).toEqual({ status: 'ok', subject: 'user-1', tenantId: 'tenant-1', role: 'manager' });
    const [url, init] = vi.mocked(fetcher).mock.calls[0] ?? [];
    expect(String(url)).toBe('http://core.test:8080/me');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer the-token');
  });

  it('gives no role when the core sends null or an unknown value', async () => {
    const body = { subject: 's', tenantId: 't' };

    expect(await fetchMe(config, 'x', respond(200, { ...body, role: null }))).toMatchObject({ role: null });
    expect(await fetchMe(config, 'x', respond(200, { ...body, role: 'admin' }))).toMatchObject({ role: null });
    expect(await fetchMe(config, 'x', respond(200, body))).toMatchObject({ role: null });
  });

  it('maps 401 to unauthorized and 403 to forbidden', async () => {
    expect(await fetchMe(config, 't', respond(401))).toEqual({ status: 'unauthorized' });
    expect(await fetchMe(config, 't', respond(403))).toEqual({ status: 'forbidden' });
  });

  it('maps a server error to unavailable', async () => {
    expect(await fetchMe(config, 't', respond(503))).toEqual({ status: 'unavailable' });
  });

  it('maps a network failure to unavailable', async () => {
    const failing = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;

    expect(await fetchMe(config, 't', failing)).toEqual({ status: 'unavailable' });
  });

  it('maps an unexpected body to unavailable', async () => {
    expect(await fetchMe(config, 't', respond(200, { hello: 'world' }))).toEqual({ status: 'unavailable' });
  });
});
