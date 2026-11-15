import { useEffect, useId, useLayoutEffect, useRef, type ReactElement, type ReactNode } from 'react';

interface ModalProps {
  readonly title: string;
  /** Extra class names, besides the ones every dialog of the register carries. */
  readonly className?: string;
  /** Called when the person presses Esc. */
  readonly onClose: () => void;
  /** Keys of this dialog besides Esc. Return true when the key was used, so it goes no further. */
  readonly onKey?: (event: KeyboardEvent) => boolean;
  readonly children: ReactNode;
}

/**
 * A dialog of the register. It opens as a modal, so the sale behind it does not take keys, and Esc closes it. The keys
 * are listened on the window, so they work wherever the focus ended up inside the dialog.
 *
 * @param props.title the heading, which also names the dialog for a screen reader
 * @param props.className extra class names
 * @param props.onClose called on Esc
 * @param props.onKey the other keys of the dialog
 * @param props.children what the dialog shows
 * @returns the dialog
 */
export function Modal({ title, className = '', onClose, onKey, children }: ModalProps): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog !== null && !dialog.open) {
      dialog.showModal();
    }
  }, []);

  // After every render, so the handler sees what is typed right now.
  useLayoutEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (onKey?.(event) === true) {
        event.preventDefault();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <dialog ref={ref} className={`payment ${className}`.trim()} aria-labelledby={titleId} closedby="none">
      <h2 id={titleId}>{title}</h2>
      {children}
    </dialog>
  );
}
