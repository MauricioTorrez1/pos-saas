import type { SyncPushRequest, SyncPushResponse } from './sync-protocol';

/** The push did not get an answer the register can use: the network failed, it took too long, or the core said no. */
export class SyncTransportError extends Error {
  /**
   * @param message what happened
   * @param status the HTTP status when the core answered, or null when there was no answer
   * @param cause the original error, if there was one
   */
  constructor(
    message: string,
    readonly status: number | null,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'SyncTransportError';
  }
}

/**
 * How the register reaches the core. The synchronizer only knows this interface, so tests use a fake that can cut the
 * connection at any point, and the real one is plain HTTP.
 */
export interface SyncTransport {
  /**
   * Sends one batch and waits for the core's answer.
   *
   * @param request the batch, in ascending `deviceSeq`
   * @returns the answer, with one result per operation the core handled
   * @throws SyncTransportError if there was no usable answer. Nothing in the batch counts as delivered then.
   * @throws SyncProtocolError if the core answered with something that is not the contract
   */
  push(request: SyncPushRequest): Promise<SyncPushResponse>;
}
