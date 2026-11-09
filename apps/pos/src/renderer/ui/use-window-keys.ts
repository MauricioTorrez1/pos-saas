import { useEffect } from 'react';

/**
 * Runs an action when a key is pressed anywhere in the window, not just in the box that has the focus. A click on the
 * backdrop leaves the keyboard outside the dialog, and the keys must still work. The listener is set again after every
 * render, so the actions always see what is on the screen.
 *
 * @param actions the action of each key, by the name `KeyboardEvent.key` gives it
 * @param isPaused while true, the keys are left alone, as when something is being saved
 */
export function useWindowKeys(actions: Readonly<Record<string, (() => void) | undefined>>, isPaused = false): void {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const action = actions[event.key];
      if (action === undefined) {
        return;
      }
      event.preventDefault();
      if (!isPaused) {
        action();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });
}
