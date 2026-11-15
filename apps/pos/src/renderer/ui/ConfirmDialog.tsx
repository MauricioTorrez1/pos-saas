import type { ReactElement, ReactNode } from 'react';

import { Modal } from './Modal';

interface ConfirmDialogProps {
  readonly title: string;
  readonly children: ReactNode;
  /** What the button that goes ahead says. */
  readonly confirmLabel: string;
  /** Whether going ahead cannot be undone, which paints the button red. */
  readonly isDangerous?: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/**
 * Asks before something that cannot be undone. Enter goes ahead and Esc gives up, so a cashier answers without the
 * mouse.
 *
 * @param props.title the question
 * @param props.children what going ahead means
 * @param props.confirmLabel what the button that goes ahead says
 * @param props.isDangerous whether the button is red
 * @param props.onConfirm called when the person goes ahead
 * @param props.onCancel called when the person gives up
 * @returns the dialog
 */
export function ConfirmDialog({ title, children, confirmLabel, isDangerous = false, onConfirm, onCancel }: ConfirmDialogProps): ReactElement {
  return (
    <Modal
      title={title}
      className="confirm"
      onClose={onCancel}
      onKey={(event) => {
        if (event.key === 'Enter') {
          onConfirm();
          return true;
        }
        return false;
      }}
    >
      <div className="confirm-body">{children}</div>
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={onCancel}>
          No, volver <kbd>Esc</kbd>
        </button>
        <button type="button" className={`button ${isDangerous ? 'button-danger' : 'button-primary'}`} tabIndex={-1} onClick={onConfirm}>
          {confirmLabel} <kbd>Enter</kbd>
        </button>
      </div>
    </Modal>
  );
}
