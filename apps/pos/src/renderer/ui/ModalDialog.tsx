import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';

interface ModalDialogProps {
  /** Id of the title, which labels the dialog. */
  readonly titleId: string;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * A modal dialog that keeps the keyboard inside and does not close with Esc by itself, so the screen decides what Esc
 * means. Its content is drawn once it is open, because a browser does not focus anything inside a closed dialog, and the
 * boxes that take the keyboard when they appear would otherwise lose it.
 *
 * @param props.titleId id of the heading inside the dialog
 * @param props.className extra class names
 * @param props.children the content
 * @returns the dialog
 */
export function ModalDialog({ titleId, className = '', children }: ModalDialogProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      dialog.showModal();
    }
    setIsOpen(true);
  }, []);

  return (
    <dialog ref={dialogRef} className={`payment ${className}`.trim()} aria-labelledby={titleId} closedby="none">
      {isOpen ? children : null}
    </dialog>
  );
}
