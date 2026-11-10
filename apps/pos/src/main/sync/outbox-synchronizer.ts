import { SyncProtocolError, MAX_BATCH_SIZE, type SyncOperationResult } from './sync-protocol';
import type { SyncOutbox } from './sync-outbox';
import type { SyncTransport } from './sync-transport';

/** What one run of the synchronizer did. */
export interface PushOutcome {
  /** Operations the core stored now. */
  readonly accepted: number;
  /** Operations the core already had, which is what a repeated push produces. */
  readonly duplicates: number;
  /** Operations the core kept for the owner to review. */
  readonly quarantined: number;
  /** Operations still waiting when the run ended. */
  readonly remaining: number;
  /** Why the run stopped before the outbox was empty, or null if it emptied. */
  readonly failure: Error | null;
}

/** What `OutboxSynchronizer` needs. */
export interface OutboxSynchronizerOptions {
  readonly outbox: SyncOutbox;
  readonly transport: SyncTransport;
  /** Identifies this register to the core. */
  readonly registerId: string;
  /** Operations per push, never more than the contract allows. */
  readonly batchSize?: number;
}

/**
 * Sends the outbox to the core in order and marks as delivered only what the core confirms, one operation at a time.
 * It never touches a sale: it only reads the outbox, so selling does not depend on it (RF-020, ADR 0040).
 */
export class OutboxSynchronizer {
  readonly #outbox: SyncOutbox;
  readonly #transport: SyncTransport;
  readonly #registerId: string;
  readonly #batchSize: number;
  #running: Promise<PushOutcome> | null = null;

  /** @param options the outbox, the way to reach the core, and who this register is */
  constructor({ outbox, transport, registerId, batchSize = MAX_BATCH_SIZE }: OutboxSynchronizerOptions) {
    if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
      throw new RangeError(`The batch size must be between 1 and ${MAX_BATCH_SIZE}`);
    }
    this.#outbox = outbox;
    this.#transport = transport;
    this.#registerId = registerId;
    this.#batchSize = batchSize;
  }

  /**
   * Sends batches until the outbox is empty or one fails. If a run is already going, it joins that one, so two pushes
   * never send the same operations at once.
   *
   * @returns what was confirmed and why it stopped. It never throws: a failure is the answer, and the loop retries later.
   */
  pushPending(): Promise<PushOutcome> {
    this.#running ??= this.#drain().finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  async #drain(): Promise<PushOutcome> {
    const totals = { accepted: 0, duplicates: 0, quarantined: 0 };
    let failure: Error | null = null;
    try {
      failure = await this.#drainInto(totals);
    } catch (error) {
      // The local database failed. Nothing was marked delivered that the core did not confirm, so the loop can retry.
      failure = error instanceof Error ? error : new Error(String(error));
    }
    return { ...totals, remaining: this.#outbox.counts().pending, failure };
  }

  async #drainInto(totals: { accepted: number; duplicates: number; quarantined: number }): Promise<Error | null> {
    let failure: Error | null = null;
    while (failure === null) {
      const batch = this.#outbox.pending(this.#batchSize);
      if (batch.length === 0) {
        break;
      }
      const results = await this.#sendBatch(batch.map(({ attempts: _attempts, ...operation }) => operation));
      if (results instanceof Error) {
        this.#outbox.markFailed(batch.map(({ opId }) => opId), results.message);
        failure = results;
        continue;
      }
      const sent = new Set(batch.map(({ opId }) => opId));
      // A result for an operation that was not in this batch says nothing about it, so it is ignored.
      const confirmed = [...new Map(results.filter(({ opId }) => sent.has(opId)).map((result) => [result.opId, result])).values()];
      this.#outbox.markDelivered(confirmed);
      for (const { status } of confirmed) {
        totals[status === 'accepted' ? 'accepted' : status === 'duplicate' ? 'duplicates' : 'quarantined'] += 1;
      }
      const confirmedIds = new Set(confirmed.map(({ opId }) => opId));
      const unconfirmed = batch.filter(({ opId }) => !confirmedIds.has(opId)).map(({ opId }) => opId);
      if (unconfirmed.length > 0) {
        this.#outbox.markFailed(unconfirmed, 'The core did not confirm this operation');
        // Without progress, sending the same batch again right away would loop forever.
        if (confirmed.length === 0) {
          failure = new SyncProtocolError('it confirmed none of the operations of the batch');
        }
      }
    }
    return failure;
  }

  async #sendBatch(operations: Parameters<SyncTransport['push']>[0]['operations']): Promise<readonly SyncOperationResult[] | Error> {
    try {
      const response = await this.#transport.push({ registerId: this.#registerId, operations });
      return response.results;
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }
}
