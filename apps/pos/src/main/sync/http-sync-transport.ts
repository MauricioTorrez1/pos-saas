import { parsePushResponse, type SyncPushRequest, type SyncPushResponse } from './sync-protocol';
import { SyncTransportError, type SyncTransport } from './sync-transport';

const DEFAULT_TIMEOUT_MS = 15_000;

/** What `HttpSyncTransport` needs. */
export interface HttpSyncTransportOptions {
  /** Address of the core, such as `https://core.example.com`. The path `/sync/push` is added. */
  readonly baseUrl: string;
  /** Longest a push may take before it counts as a failure, so a dead connection never hangs the loop. */
  readonly timeoutMs?: number;
  /**
   * The device credential the core gave this register when it enrolled (`<tenantId>.<secret>`, ADR 0054). It goes in
   * `Authorization: Device <credential>` and nowhere else: it is never logged and never part of an error message.
   * Without it the core answers 401 and the operations wait in the outbox.
   */
  readonly deviceToken?: string;
  /** Replaces `fetch`. Only tests pass it. */
  readonly fetchImpl?: typeof fetch;
}

/** Sends batches to `POST /sync/push` over HTTP. The register signs in with its device credential (E1-41). */
export class HttpSyncTransport implements SyncTransport {
  readonly #url: string;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #headers: Record<string, string>;

  /** @param options where the core is and the credential of this register */
  constructor({ baseUrl, timeoutMs = DEFAULT_TIMEOUT_MS, deviceToken, fetchImpl = fetch }: HttpSyncTransportOptions) {
    this.#url = `${baseUrl.replace(/\/+$/, '')}/sync/push`;
    this.#timeoutMs = timeoutMs;
    this.#fetch = fetchImpl;
    const token = deviceToken?.trim();
    this.#headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token === undefined || token === '' ? {} : { Authorization: `Device ${token}` }),
    };
  }

  /** {@inheritDoc SyncTransport.push} */
  async push(request: SyncPushRequest): Promise<SyncPushResponse> {
    let response: Response;
    try {
      response = await this.#fetch(this.#url, {
        method: 'POST',
        headers: this.#headers,
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
}
