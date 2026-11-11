import type { ChangeApplier } from './change-applier';
import { MAX_PULL_PAGE_SIZE } from './pull-protocol';
import { SyncTransportError, type PullTransport } from './sync-transport';

/** What one run of the puller did. */
export interface PullOutcome {
  /** Pages applied in this run. */
  readonly pages: number;
  /** Changes applied in this run. */
  readonly changes: number;
  /** The cursor when the run ended. */
  readonly cursor: string;
  /** Why the run stopped before it caught up, or null if it did. */
  readonly failure: Error | null;
}

/** What `ChangePuller` needs. */
export interface ChangePullerOptions {
  readonly applier: ChangeApplier;
  readonly transport: PullTransport;
  /** Changes asked for per page, never more than the core allows. */
  readonly pageSize?: number;
}

/** The page size asked for by default. */
export const DEFAULT_PULL_PAGE_SIZE = 200;

/**
 * Downloads what changed in the core, page by page, until the register has caught up or something fails. A page is applied
 * only after it arrived whole and was checked, so a network cut in the middle of a page loses nothing: the cursor still
 * points at the last page that was applied, and the next run asks for the rest. It never touches a sale or the outbox, so
 * selling and sending do not wait for it (RF-020, ADR 0048).
 */
export class ChangePuller {
  readonly #applier: ChangeApplier;
  readonly #transport: PullTransport;
  readonly #pageSize: number;
  #running: Promise<PullOutcome> | null = null;

  /** @param options where changes are applied and how to reach the core */
  constructor({ applier, transport, pageSize = DEFAULT_PULL_PAGE_SIZE }: ChangePullerOptions) {
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PULL_PAGE_SIZE) {
      throw new RangeError(`The page size must be between 1 and ${MAX_PULL_PAGE_SIZE}`);
    }
    this.#applier = applier;
    this.#transport = transport;
    this.#pageSize = pageSize;
  }

  /**
   * Pulls until caught up or until a failure. If a run is already going, it joins that one, so two pulls never apply the
   * same page at once.
   *
   * @returns what was applied and why it stopped. It never throws: a failure is the answer, and the loop tries again later.
   */
  pullAll(): Promise<PullOutcome> {
    this.#running ??= this.#drain().finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  async #drain(): Promise<PullOutcome> {
    let pages = 0;
    let changes = 0;
    let failure: Error | null = null;
    try {
      let hasMore = true;
      while (hasMore) {
        const page = await this.#transport.pull(this.#applier.currentCursor(), this.#pageSize);
        const outcome = this.#applier.apply(page);
        pages += 1;
        changes += page.changes.length;
        hasMore = page.hasMore && outcome.cursor === page.nextCursor && page.changes.length > 0;
      }
    } catch (error) {
      failure = this.#recover(error);
    }
    return { pages, changes, cursor: this.#applier.currentCursor(), failure };
  }

  /** A core that is behind the register means it was restored from a backup: start over instead of failing forever. */
  #recover(error: unknown): Error {
    const failure = error instanceof Error ? error : new Error(String(error));
    if (failure instanceof SyncTransportError && failure.status === 409) {
      this.#applier.resetCursor();
      return new Error('The core is behind this register, so the cursor was reset and the next pull starts over', { cause: failure });
    }
    return failure;
  }
}
