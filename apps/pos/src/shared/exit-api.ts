/** The channels of closing the register with the cash still open (E1-54, ADR 0070). */
export const EXIT_CHANNELS = {
  /** Main to screen: somebody is closing the window and the cash is open, so the screen asks what to do. */
  requested: 'exit:requested',
  /** Screen to main: what the person decided. */
  answer: 'exit:answer',
} as const;

/**
 * What the screen tells the main process about a request to close.
 *
 * - `received`: the screen got the request and is showing the question. Without it, a second close means the screen is
 *   frozen, and the window closes anyway.
 * - `leave_open`: close without a cut. The session stays open and the audit log says so.
 * - `cut_done`: the cut was made, so the window may close.
 * - `cancel`: the person went back to work.
 */
export type ExitAnswer = 'received' | 'leave_open' | 'cut_done' | 'cancel';

/** Every answer the main process accepts, to check what crosses the bridge. */
export const EXIT_ANSWERS: readonly ExitAnswer[] = ['received', 'leave_open', 'cut_done', 'cancel'];

/** The bridge for closing the register with the cash open. */
export interface ExitApi {
  /**
   * Listens for requests to close while the cash is open.
   *
   * @param listener called each time somebody closes the window
   * @returns a function that stops listening
   */
  onExitRequested(listener: () => void): () => void;
  /**
   * Tells the main process what to do with the request.
   *
   * @param answer what the person decided
   */
  answerExit(answer: ExitAnswer): Promise<void>;
}
