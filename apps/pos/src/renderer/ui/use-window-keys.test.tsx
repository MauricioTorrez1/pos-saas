import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useWindowKeys } from './use-window-keys';

type ActEnvironment = typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = true;
  root?.unmount();
  container?.remove();
  root = null;
  container = null;
});

function Keyed({ onEnter }: { readonly onEnter: () => void }): React.ReactElement {
  useWindowKeys({ Enter: onEnter });
  return <p>ready</p>;
}

describe('useWindowKeys', () => {
  it('listens from the moment its screen is in the page, so a key pressed right then is not lost', async () => {
    // No act(): this is how the browser runs React, where effects of the passive kind wait for a later turn.
    (globalThis as ActEnvironment).IS_REACT_ACT_ENVIRONMENT = false;
    const onEnter = vi.fn<() => void>();
    container = document.body.appendChild(document.createElement('div'));
    const keyedScreenShown = new Promise<void>((resolve) => {
      // A mutation observer answers in the microtask after the page changes, before any later turn of the scheduler.
      const observer = new MutationObserver(() => {
        if (container?.textContent === 'ready') {
          observer.disconnect();
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
          resolve();
        }
      });
      observer.observe(container!, { childList: true, subtree: true });
    });

    root = createRoot(container);
    root.render(<Keyed onEnter={onEnter} />);
    await keyedScreenShown;

    expect(onEnter).toHaveBeenCalledTimes(1);
  });
});
