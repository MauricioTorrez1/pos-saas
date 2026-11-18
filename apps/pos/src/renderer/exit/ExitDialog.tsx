import type { ReactElement } from 'react';

import { ModalDialog } from '../ui/ModalDialog';
import { useWindowKeys } from '../ui/use-window-keys';

interface ExitDialogProps {
  /** Who opened the cash that is still open, to say whose shift it is. */
  readonly openedBy: string | null;
  /** True at the sign-in screen: the cut needs somebody signed in first. */
  readonly needsSignIn: boolean;
  readonly onCut: () => void;
  readonly onLeaveOpen: () => void;
  readonly onCancel: () => void;
}

/**
 * The question when the register closes with the cash open (E1-54): make the cut first, or close and leave the session
 * open for whoever comes next. Esc goes back to work.
 *
 * @param props.openedBy who opened the cash
 * @param props.needsSignIn true when nobody is signed in
 * @param props.onCut called to make the cut before closing
 * @param props.onLeaveOpen called to close without a cut
 * @param props.onCancel called to keep working
 * @returns the dialog
 */
export function ExitDialog({ openedBy, needsSignIn, onCut, onLeaveOpen, onCancel }: ExitDialogProps): ReactElement {
  useWindowKeys({ F2: onCut, F4: onLeaveOpen, Escape: onCancel });

  return (
    <ModalDialog titleId="exit-title" className="exit">
      <h2 id="exit-title">¿Cerrar la caja?</h2>
      <p>
        La caja sigue abierta{openedBy === null ? '' : ` (la abrió ${openedBy})`}. Haz el corte antes de irte, o sal y deja la caja
        abierta para el siguiente turno.
      </p>
      {needsSignIn && <p className="quantity-price">Para hacer el corte, primero entra con tu PIN.</p>}
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={onCancel}>
          Volver <kbd>Esc</kbd>
        </button>
        <button type="button" className="button" tabIndex={-1} onClick={onLeaveOpen}>
          No hacer corte y salir <kbd>F4</kbd>
        </button>
        <button type="button" className="button button-primary" tabIndex={-1} onClick={onCut}>
          Hacer corte de caja <kbd>F2</kbd>
        </button>
      </div>
    </ModalDialog>
  );
}
