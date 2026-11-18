import { describe, expect, it, vi } from 'vitest';

import type { AuditEntry } from '../audit/audit-log';
import { ExitGuard, type GuardedSession } from './exit-guard';

const SESSION: GuardedSession = { id: 'session-1', openedById: 'owner-1' };

function guardWith(options: { session?: GuardedSession | null; userId?: string | null } = {}) {
  let session = options.session === undefined ? SESSION : options.session;
  const entries: AuditEntry[] = [];
  const askScreen = vi.fn();
  const closeWindow = vi.fn();
  const guard = new ExitGuard({
    openSession: () => session,
    currentUserId: () => (options.userId === undefined ? 'cashier-1' : options.userId),
    audit: { record: (entry) => entries.push(entry) },
    askScreen,
    closeWindow,
  });
  return { guard, entries, askScreen, closeWindow, closeSession: () => (session = null) };
}

describe('ExitGuard', () => {
  it('lets the window close without asking when no cash is open', () => {
    const { guard, askScreen, entries } = guardWith({ session: null });

    expect(guard.onCloseRequested()).toBe(true);
    expect(askScreen).not.toHaveBeenCalled();
    expect(entries).toEqual([]);
  });

  it('stops the close and asks the screen while cash is open', () => {
    const { guard, askScreen, closeWindow } = guardWith();

    expect(guard.onCloseRequested()).toBe(false);
    expect(askScreen).toHaveBeenCalledOnce();
    expect(closeWindow).not.toHaveBeenCalled();
  });

  it('closes without a cut when asked, and writes who left the session open', () => {
    const { guard, entries, closeWindow } = guardWith();
    guard.onCloseRequested();
    guard.onAnswer('received');

    guard.onAnswer('leave_open');

    expect(closeWindow).toHaveBeenCalledOnce();
    expect(entries).toEqual([
      expect.objectContaining({ userId: 'cashier-1', action: 'cash_session.exit_without_cut', entity: 'cash_session', entityId: 'session-1' }),
    ]);
    // The close that follows is the guard's own, so it goes through.
    expect(guard.onCloseRequested()).toBe(true);
  });

  it('names the person who opened the cash when nobody is signed in', () => {
    const { guard, entries } = guardWith({ userId: null });
    guard.onCloseRequested();
    guard.onAnswer('received');

    guard.onAnswer('leave_open');

    expect(entries[0]?.userId).toBe('owner-1');
  });

  it('closes after the cut, with nothing in the audit log', () => {
    const { guard, entries, closeWindow, closeSession } = guardWith();
    guard.onCloseRequested();
    guard.onAnswer('received');
    closeSession();

    guard.onAnswer('cut_done');

    expect(closeWindow).toHaveBeenCalledOnce();
    expect(entries).toEqual([]);
  });

  it('stays open when the cut did not close the session', () => {
    const { guard, closeWindow } = guardWith();
    guard.onCloseRequested();
    guard.onAnswer('received');

    guard.onAnswer('cut_done');

    expect(closeWindow).not.toHaveBeenCalled();
    expect(guard.onCloseRequested()).toBe(false);
  });

  it('goes back to work when cancelled, and asks again on the next close', () => {
    const { guard, askScreen } = guardWith();
    guard.onCloseRequested();
    guard.onAnswer('received');

    guard.onAnswer('cancel');

    expect(guard.onCloseRequested()).toBe(false);
    expect(askScreen).toHaveBeenCalledTimes(2);
  });

  it('asks again instead of closing when the screen is showing the question', () => {
    const { guard, entries } = guardWith();
    guard.onCloseRequested();
    guard.onAnswer('received');

    expect(guard.onCloseRequested()).toBe(false);
    expect(entries).toEqual([]);
  });

  it('lets a frozen screen close on the second try, and records it', () => {
    const { guard, entries } = guardWith();
    guard.onCloseRequested();

    expect(guard.onCloseRequested()).toBe(true);
    expect(entries[0]?.detail).toContain('no respondió');
  });

  it('never waits for a screen that crashed', () => {
    const { guard, entries, askScreen } = guardWith();
    guard.onScreenGone();

    expect(guard.onCloseRequested()).toBe(true);
    expect(askScreen).not.toHaveBeenCalled();
    expect(entries[0]?.detail).toContain('se cayó');
  });

  it('never stops Windows from shutting down, and records it once', () => {
    const { guard, entries } = guardWith();
    guard.onCloseRequested();

    guard.onSessionEnd();

    expect(guard.onCloseRequested()).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.detail).toContain('Windows');
  });

  it('ignores answers nobody asked for, so the screen cannot close the register by itself', () => {
    const { guard, closeWindow, entries } = guardWith();

    guard.onAnswer('leave_open');
    guard.onAnswer('cut_done');

    expect(closeWindow).not.toHaveBeenCalled();
    expect(entries).toEqual([]);
  });
});
