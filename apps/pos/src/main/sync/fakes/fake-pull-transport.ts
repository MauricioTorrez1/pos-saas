import { parsePullResponse, type PullPage, type ProductState, type StaffMemberState } from '../pull-protocol';
import { SyncTransportError, type PullTransport } from '../sync-transport';

/** Where the fake loses the network. */
export type PullCut = 'before-the-core-answers' | 'in-the-middle-of-the-answer';

const PRODUCT_ID_BASE = '0193a5c0-0000-7000-8000-0000000001';

/**
 * A core that lives in memory, for tests. It numbers changes like the real feed, returns the same changes for the same
 * cursor, and can lose the network before it answers or in the middle of the answer. What it returns goes through JSON and
 * `parsePullResponse`, so a test cannot pass with a shape the register would refuse in production.
 */
export class FakePullTransport implements PullTransport {
  /** Every request the register made, as `[cursor, limit]`. */
  readonly requests: [string, number][] = [];
  readonly #feed: unknown[] = [];
  readonly #cuts: PullCut[] = [];
  #failWith: SyncTransportError | null = null;

  /**
   * Builds a product id that is a valid UUIDv7 and the same for the same number.
   *
   * @param number which product
   * @returns the id
   */
  static productId(number: number): string {
    return `${PRODUCT_ID_BASE}${String(number).padStart(2, '0')}`;
  }

  /**
   * Publishes the new state of a product, as the core does when the owner edits it in the panel.
   *
   * @param number which product, see `productId`
   * @param state the whole state of the product
   */
  publishProduct(number: number, state: ProductState): void {
    this.#append('product', FakePullTransport.productId(number), state);
  }

  /**
   * Publishes the removal of a product.
   *
   * @param number which product
   */
  deleteProduct(number: number): void {
    this.#append('product', FakePullTransport.productId(number), undefined);
  }

  /**
   * Publishes the new state of a staff member.
   *
   * @param id the id of the person
   * @param state the whole state
   */
  publishStaff(id: string, state: StaffMemberState): void {
    this.#append('staff_member', id, state);
  }

  /**
   * Publishes something the register does not know how to apply, like a newer core would.
   *
   * @param entityType the unknown kind of entity
   */
  publishUnknown(entityType: string): void {
    this.#append(entityType, FakePullTransport.productId(99), { anything: true });
  }

  /**
   * Makes the next pull lose the network at the given moment.
   *
   * @param cut where the connection drops
   * @returns this, to chain
   */
  cutNext(cut: PullCut): this {
    this.#cuts.push(cut);
    return this;
  }

  /**
   * Makes every pull fail with this status until `recover` is called.
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

  /** The number of the last change, which a cursor above it is ahead of the core. */
  get head(): number {
    return this.#feed.length;
  }

  /** {@inheritDoc PullTransport.pull} */
  pull(cursor: string, limit: number): Promise<PullPage> {
    this.requests.push([cursor, limit]);
    const cut = this.#cuts.shift();
    if (cut === 'before-the-core-answers') {
      return Promise.reject(new SyncTransportError('The core could not be reached', null));
    }
    if (this.#failWith !== null) {
      return Promise.reject(this.#failWith);
    }
    const after = Number(cursor);
    if (after > this.#feed.length) {
      return Promise.reject(new SyncTransportError('The core answered 409', 409));
    }
    const changes = this.#feed.slice(after, after + limit);
    const nextCursor = String(after + changes.length);
    const body = JSON.parse(JSON.stringify({ changes, nextCursor, hasMore: after + changes.length < this.#feed.length })) as unknown;
    if (cut === 'in-the-middle-of-the-answer') {
      return Promise.reject(new SyncTransportError('The answer of the core was cut off', 200));
    }
    return Promise.resolve(parsePullResponse(body));
  }

  #append(entityType: string, entityId: string, state: unknown): void {
    const seq = this.#feed.length + 1;
    const base = { seq, entityType, entityId, schemaVersion: 1, changedAt: '2026-12-10T18:21:04.123Z' };
    this.#feed.push(state === undefined ? { ...base, deleted: true } : { ...base, deleted: false, payload: state });
  }
}
