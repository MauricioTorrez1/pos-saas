import type { ExitAnswer } from '../../shared/exit-api';
import type { AuditEntry } from '../audit/audit-log';

/** The open session, as the guard needs it. */
export interface GuardedSession {
  readonly id: string;
  /** Who opened it, so an exit with nobody signed in still names somebody in the audit log. */
  readonly openedById: string;
}

/** What the guard reads and does. Each part is a function, so a test can drive it without Electron. */
export interface ExitGuardDependencies {
  /** @returns the open cash session, or null */
  readonly openSession: () => GuardedSession | null;
  /** @returns the id of the person signed in, or null at the sign-in screen */
  readonly currentUserId: () => string | null;
  readonly audit: { record(entry: AuditEntry): void };
  /** Asks the screen what to do with the request to close. */
  readonly askScreen: () => void;
  /** Closes the window for real. The guard lets that close through. */
  readonly closeWindow: () => void;
}

/** Why the window closed with the cash still open. Each reason is a different line in the audit log. */
type LeaveReason = 'chosen' | 'screen_frozen' | 'screen_gone' | 'windows_shutdown';

const LEAVE_DETAIL: Record<LeaveReason, string> = {
  chosen: 'Cerró la caja sin hacer corte; la sesión quedó abierta',
  screen_frozen: 'La pantalla no respondió al cerrar; la sesión quedó abierta',
  screen_gone: 'La pantalla se cayó antes de cerrar; la sesión quedó abierta',
  windows_shutdown: 'Windows se apagó con la caja abierta; la sesión quedó abierta',
};

type State = 'idle' | 'asked' | 'received' | 'released';

/**
 * Decides whether the register window may close (E1-54, ADR 0070). With no cash open it always may. With cash open it
 * stops the close and asks the screen, which offers the cut or leaving without it. The guard never blocks a close it cannot
 * ask about: a frozen or crashed screen, or Windows shutting down, let the window close and leave a line in the audit log.
 * Nothing is lost either way, because every sale and movement is already committed to SQLite.
 */
export class ExitGuard {
  readonly #deps: ExitGuardDependencies;
  #state: State = 'idle';
  #isScreenGone = false;

  /** @param deps what the guard reads and does */
  constructor(deps: ExitGuardDependencies) {
    this.#deps = deps;
  }

  /**
   * Called on every request to close the window: the X, Alt+F4, or quitting from the menu.
   *
   * @returns true to let the window close, false to keep it open while the screen asks
   */
  onCloseRequested(): boolean {
    if (this.#state === 'released') {
      return true;
    }
    const session = this.#deps.openSession();
    if (session === null) {
      return true;
    }
    if (this.#isScreenGone) {
      this.#leave(session, 'screen_gone');
      return true;
    }
    if (this.#state === 'asked') {
      // The screen never said it got the first request, so it is frozen. A second close must work.
      this.#leave(session, 'screen_frozen');
      return true;
    }
    this.#state = this.#state === 'received' ? 'received' : 'asked';
    this.#deps.askScreen();
    return false;
  }

  /**
   * Called with what the screen answered.
   *
   * @param answer what the person decided
   */
  onAnswer(answer: ExitAnswer): void {
    if (this.#state === 'idle' || this.#state === 'released') {
      // Nobody asked: the screen cannot close the register on its own.
      return;
    }
    switch (answer) {
      case 'received':
        this.#state = 'received';
        return;
      case 'cancel':
        this.#state = 'idle';
        return;
      case 'leave_open': {
        const session = this.#deps.openSession();
        if (session !== null) {
          this.#leave(session, 'chosen');
        }
        this.#release();
        return;
      }
      case 'cut_done':
        if (this.#deps.openSession() === null) {
          this.#release();
        } else {
          // The cut did not close the session, so there is still cash to answer for.
          this.#state = 'idle';
        }
        return;
    }
  }

  /** Called when the screen crashed or was killed: from then on, closing never waits for it. */
  onScreenGone(): void {
    this.#isScreenGone = true;
  }

  /** Called when Windows shuts down or signs out. The register never stops that, and records it. */
  onSessionEnd(): void {
    const session = this.#deps.openSession();
    if (session !== null && this.#state !== 'released') {
      this.#leave(session, 'windows_shutdown');
    }
    this.#state = 'released';
  }

  #release(): void {
    this.#state = 'released';
    this.#deps.closeWindow();
  }

  #leave(session: GuardedSession, reason: LeaveReason): void {
    this.#state = 'released';
    this.#deps.audit.record({
      userId: this.#deps.currentUserId() ?? session.openedById,
      action: 'cash_session.exit_without_cut',
      entity: 'cash_session',
      entityId: session.id,
      detail: LEAVE_DETAIL[reason],
    });
  }
}
