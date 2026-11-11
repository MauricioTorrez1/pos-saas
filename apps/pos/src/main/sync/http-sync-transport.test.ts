import { describe, expect, it } from 'vitest';

import { HttpSyncTransport } from './http-sync-transport';
import { parsePushResponse, SyncProtocolError, type SyncPushRequest } from './sync-protocol';
import { SyncTransportError } from './sync-transport';

const OP_ID = '0193a5c0-0000-7000-8000-000000000010';
const REQUEST: SyncPushRequest = {
  registerId: '0193a5c0-0000-7000-8000-000000000001',
  operations: [{ opId: OP_ID, deviceSeq: 1, type: 'cash_movement.recorded', schemaVersion: 1, occurredAt: '2026-12-10T18:21:04.000Z', payload: {} }],
};

function transportAnswering(answer: () => Response | Promise<Response>, calls: { url: string; init: RequestInit }[] = []): HttpSyncTransport {
  return new HttpSyncTransport({
    baseUrl: 'https://core.example.com/',
    fetchImpl: ((url: string, init: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(answer());
    }) as typeof fetch,
  });
}

describe('pushing over HTTP', () => {
  it('posts the batch as JSON to /sync/push and reads the result of each operation', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const transport = transportAnswering(() => Response.json({ results: [{ opId: OP_ID, status: 'accepted' }] }), calls);

    const response = await transport.push(REQUEST);

    expect(response).toEqual({ results: [{ opId: OP_ID, status: 'accepted' }] });
    expect(calls[0]!.url).toBe('https://core.example.com/sync/push');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual(REQUEST);
  });

  it('sends no card data and no credentials in the headers', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    await transportAnswering(() => Response.json({ results: [] }), calls).push(REQUEST);

    expect(Object.keys(calls[0]!.init.headers as Record<string, string>)).toEqual(['Content-Type', 'Accept']);
  });

  it.each([400, 401, 429, 500, 503])('fails with the status when the core answers %s, so nothing is confirmed', async (status) => {
    const transport = transportAnswering(() => new Response('oops', { status }));

    await expect(transport.push(REQUEST)).rejects.toMatchObject({ name: 'SyncTransportError', status });
  });

  it('fails without a status when the network is down', async () => {
    const transport = new HttpSyncTransport({ baseUrl: 'https://core.example.com', fetchImpl: (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch });

    await expect(transport.push(REQUEST)).rejects.toMatchObject({ name: 'SyncTransportError', status: null });
  });

  it('fails when the answer is cut off in the middle, which is safe to retry', async () => {
    const transport = transportAnswering(() => new Response('{"results": [{"opId"', { status: 200 }));

    await expect(transport.push(REQUEST)).rejects.toBeInstanceOf(SyncTransportError);
  });

  it('gives up on a core that never answers', async () => {
    const transport = new HttpSyncTransport({
      baseUrl: 'https://core.example.com',
      timeoutMs: 20,
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('Timed out', 'TimeoutError')));
        })) as typeof fetch,
    });

    await expect(transport.push(REQUEST)).rejects.toMatchObject({ name: 'SyncTransportError', status: null });
  });

  it('does not believe an answer that does not follow the contract', async () => {
    const transport = transportAnswering(() => Response.json({ ok: true }));

    await expect(transport.push(REQUEST)).rejects.toBeInstanceOf(SyncProtocolError);
  });
});

describe('reading the answer of the core', () => {
  it('keeps the reason of a quarantined operation', () => {
    expect(parsePushResponse({ results: [{ opId: OP_ID, status: 'quarantined', reason: 'The payments do not add up' }] })).toEqual({
      results: [{ opId: OP_ID, status: 'quarantined', reason: 'The payments do not add up' }],
    });
  });

  it.each([
    ['a body that is not an object', 'results'],
    ['a null body', null],
    ['no results list', {}],
    ['a result that is not an object', { results: ['accepted'] }],
    ['a result without an id', { results: [{ status: 'accepted' }] }],
    ['an unknown status', { results: [{ opId: OP_ID, status: 'ok' }] }],
    ['a quarantine without a reason', { results: [{ opId: OP_ID, status: 'quarantined' }] }],
  ])('rejects %s', (_description, body) => {
    expect(() => parsePushResponse(body)).toThrow(SyncProtocolError);
  });
});

describe('pulling over HTTP', () => {
  const CABLE = '0193a5c0-0000-7000-8000-000000000050';
  const PAGE = {
    changes: [
      {
        seq: 1,
        entityType: 'product',
        entityId: CABLE,
        deleted: false,
        schemaVersion: 1,
        changedAt: '2026-12-10T18:21:04.123Z',
        payload: { name: 'Cable', baseUnit: 'meter', unitPriceE4: 386_667, taxFactor: 'rate', taxRateBp: 1600, barcodes: [] },
      },
    ],
    nextCursor: '1',
    hasMore: false,
  };

  it('asks GET /sync/pull with the cursor and the page size, and reads the page', async () => {
    const calls: { url: string; init: RequestInit }[] = [];

    const page = await transportAnswering(() => Response.json(PAGE), calls).pull('0', 200);

    expect(page.nextCursor).toBe('1');
    expect(page.changes[0]).toMatchObject({ seq: 1, entityId: CABLE, deleted: false });
    expect(calls[0]!.url).toBe('https://core.example.com/sync/pull?cursor=0&limit=200');
    expect(calls[0]!.init.method).toBe('GET');
  });

  it('counts a status that is not 200 as no answer, and keeps the status so a 409 can be told apart', async () => {
    await expect(transportAnswering(() => new Response('', { status: 409 })).pull('9', 200)).rejects.toMatchObject({ name: 'SyncTransportError', status: 409 });
    await expect(transportAnswering(() => new Response('', { status: 503 })).pull('0', 200)).rejects.toBeInstanceOf(SyncTransportError);
  });

  it('counts a cut answer as no answer', async () => {
    await expect(transportAnswering(() => new Response('{"changes": [', { status: 200 })).pull('0', 200)).rejects.toBeInstanceOf(SyncTransportError);
  });

  it('refuses an answer that is not the contract', async () => {
    await expect(transportAnswering(() => Response.json({ changes: 'many' })).pull('0', 200)).rejects.toBeInstanceOf(SyncProtocolError);
  });
});
