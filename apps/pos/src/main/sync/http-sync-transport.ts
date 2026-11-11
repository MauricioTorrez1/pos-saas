import { parsePushResponse, type SyncPushRequest, type SyncPushResponse } from './sync-protocol';
import { parsePullResponse, type PullPage } from './pull-protocol';
import { SyncTransportError, type PullTransport, type SyncTransport } from './sync-transport';

const DEFAULT_TIMEOUT_MS = 15_000;

/** What `HttpSyncTransport` needs. */
export interface HttpSyncTransportOptions {
  /** Address of the core, such as `https://core.example.com`. The paths `/sync/push` and `/sync/pull` are added. */
  readonly baseUrl: string;
  /** Longest a push may take before it counts as a failure, so a dead connection never hangs the loop. */
  readonly timeoutMs?: number;
  /** Replaces `fetch`. Only tests pass it. */
  readonly fetchImpl?: typeof fetch;
}

/** Sends batches to `POST /sync/push` and reads `GET /sync/pull` over HTTP. Sign-in headers arrive with the enrollment of the register (F0-15). */
export class HttpSyncTransport implements SyncTransport, PullTransport {
  readonly #url: string;
  readonly #pullUrl: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  /** @param options where the core is */
  constructor({ baseUrl, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = fetch }: HttpSyncTransportOptions) {
    const root = baseUrl.replace(/\/+$/, '');
    this.#url = `${root}/sync/push`;
    this.#pullUrl = `${root}/sync/pull`;
    this.#timeoutMs = timeoutMs;
    this.#fetch = fetchImpl;
  }

  /** {@inheritDoc SyncTransport.push} */
  async push(request: SyncPushRequest): Promise<SyncPushResponse> {
    let response: Response;
    try {
      response = await this.#fetch(this.#url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (cause) {
      throw new SyncTransportError('The core could not be reached', null, cause);
    }
    if (!response.ok) {
      // The body is not read: an error page says nothing the register can act on, and it could be large.
      throw new SyncTransportError(`The core answered ${response.status}`, response.status);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      // A cut in the middle of the answer: the core may have stored the batch, and sending it again is safe.
      throw new SyncTransportError('The answer of the core was cut off', response.status, cause);
    }
    return parsePushResponse(body);
  }

  /** {@inheritDoc PullTransport.pull} */
  async pull(cursor: string, limit: number): Promise<PullPage> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#pullUrl}?${new URLSearchParams({ cursor, limit: String(limit) })}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (cause) {
      throw new SyncTransportError('The core could not be reached', null, cause);
    }
    if (!response.ok) {
      throw new SyncTransportError(`The core answered ${response.status}`, response.status);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch (cause) {
      // Nothing was applied, so asking again with the same cursor is safe.
      throw new SyncTransportError('The answer of the core was cut off', response.status, cause);
    }
    return parsePullResponse(body);
  }
}
