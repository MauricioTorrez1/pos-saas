import { SyncTransportError, type SyncTransport } from '../sync-transport';
import type { SyncOperationResult, SyncPushRequest, SyncPushResponse } from '../sync-protocol';

/** Where the fake cuts the connection. */
export type NetworkCut = 'before-the-core-receives' | 'after-the-core-stores-before-answering';

/**
 * A core that lives in memory, for tests. It stores each `opId` once like the real one will (RF-021), and it can lose the
 * network at the two moments that matter: before the batch arrives, and after the core stored it but before the register
 * hears the answer. The second one is what makes a naive client send a sale twice.
 */
export class FakeSyncTransport implements SyncTransport {
  /** Every operation the core stored, in the order it stored them. */
  readonly stored: SyncPushRequest['operations'][number][] = [];
  /** Every request the register sent, whether or not it got through. */
  readonly requests: SyncPushRequest[] = [];
  readonly #storedIds = new Set<string>();
  readonly #cuts: NetworkCut[] = [];
  readonly #quarantine = new Set<string>();
  #stopAfter: number | null = null;
  #failWith: SyncTransportError | null = null;

  /**
   * Makes the next push lose the network at the given moment.
   *
   * @param cut where the connection drops
   * @returns this, to chain
   */
  cutNext(cut: NetworkCut): this {
    this.#cuts.push(cut);
    return this;
  }

  /**
   * Makes every push fail with this status until `recover` is called, like a core that is down.
   *
   * @param status the HTTP status to answer with
   */
  failWith(status: number): void {
    this.#failWith = new SyncTransportError(`The core answered ${status}`, status);
  }

  /** Makes the core work again after `failWith`. */
  recover(): void {
    this.#failWith = null;
  }

  /**
   * Makes the core handle only this many operations of the next batch and leave the rest out of its answer.
   *
   * @param count how many operations to handle
   */
  stopAfterNext(count: number): void {
    this.#stopAfter = count;
  }

  /**
   * Makes the core quarantine an operation instead of accepting it.
   *
   * @param opId the operation to refuse
   */
  quarantine(opId: string): void {
    this.#quarantine.add(opId);
  }

  /** {@inheritDoc SyncTransport.push} */
  push(request: SyncPushRequest): Promise<SyncPushResponse> {
    this.requests.push(request);
    if (this.#failWith !== null) {
      return Promise.reject(this.#failWith);
    }
    const cut = this.#cuts.shift();
    if (cut === 'before-the-core-receives') {
      return Promise.reject(new SyncTransportError('The core could not be reached', null));
    }
    const handled = this.#stopAfter === null ? request.operations : request.operations.slice(0, this.#stopAfter);
    this.#stopAfter = null;
    const results = handled.map((operation): SyncOperationResult => {
      if (this.#storedIds.has(operation.opId)) {
        return { opId: operation.opId, status: 'duplicate' };
      }
      if (this.#quarantine.has(operation.opId)) {
        return { opId: operation.opId, status: 'quarantined', reason: 'Refused by the test' };
      }
      this.#storedIds.add(operation.opId);
      this.stored.push(operation);
      return { opId: operation.opId, status: 'accepted' };
    });
    if (cut === 'after-the-core-stores-before-answering') {
      return Promise.reject(new SyncTransportError('The connection dropped before the answer arrived', null));
    }
    return Promise.resolve({ results });
  }
}
