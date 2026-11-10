import { formatCents, formatUnitPriceE4 } from '@pos-saas/money';
import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type ReactElement } from 'react';

import type { CatalogProduct } from '../../shared/pos-api';
import { formatQuantity, unitLabel } from './format';
import { readQuantity } from './quantity-entry';

interface QuantityDialogProps {
  readonly product: CatalogProduct;
  /** Called with the quantity in thousandths of the unit, once the cashier says it is right. */
  readonly onConfirm: (quantityMilli: number) => void;
  readonly onCancel: () => void;
}

/**
 * Asks how much of a product sold by weight, length, or volume to add, and shows what the line will cost before it is
 * added (RF-012). Enter adds it. A quantity above what a shop sells at once needs F2 instead, so typing 125 kg for 1.25
 * kg, or the Enter that ends a barcode scan, cannot add a wrong line without the cashier noticing (E1-08).
 *
 * @param props.product the product being measured
 * @param props.onConfirm receives the quantity in thousandths
 * @param props.onCancel called with Esc
 * @returns the dialog
 */
export function QuantityDialog({ product, onConfirm, onCancel }: QuantityDialogProps): ReactElement {
  const [text, setText] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const reading = readQuantity(text, product);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) {
      dialog.showModal();
    }
    setIsOpen(true);
  }, []);

  // The box takes the keyboard when it appears, and a browser does not focus anything inside a closed dialog.
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  // On the window, so the keys work wherever the focus ended up. It runs after every render to see what is typed.
  useLayoutEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
      } else if (event.key === 'F2' && reading.status === 'ok') {
        event.preventDefault();
        onConfirm(reading.quantity.milli);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (reading.status === 'ok' && !reading.needsConfirmation) {
          onConfirm(reading.quantity.milli);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <dialog ref={dialogRef} className="payment quantity" aria-labelledby="quantity-title" closedby="none">
      <h2 id="quantity-title">¿Cuánto {product.name}?</h2>
      <p className="quantity-price">
        {formatUnitPriceE4(product.unitPriceE4)} por {unitLabel(product.unit)}
      </p>
      {isOpen && (
        <label className="payment-field">
          <span>Cantidad en {unitLabel(product.unit)}</span>
          <input
            ref={inputRef}
            aria-label="Cantidad"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={text}
            onChange={(event: ChangeEvent<HTMLInputElement>) => setText(event.target.value)}
          />
        </label>
      )}
      <p className="payment-total">
        <span>Importe</span>
        <output aria-label="Importe de la línea">{reading.status === 'ok' ? formatCents(reading.amountCents) : '$0.00'}</output>
      </p>
      {reading.status === 'invalid' && (
        <p className="notice" role="alert">
          {reading.message}
        </p>
      )}
      {reading.status === 'ok' && reading.needsConfirmation && (
        <p className="notice" role="alert">
          {formatQuantity(reading.quantity)} es mucho para una sola línea. Si es correcto, oprime F2. Si no, corrígelo.
        </p>
      )}
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={onCancel}>
          Cancelar <kbd>Esc</kbd>
        </button>
        <button
          type="button"
          className="button button-primary"
          tabIndex={-1}
          disabled={reading.status !== 'ok' || reading.needsConfirmation}
          onClick={() => reading.status === 'ok' && onConfirm(reading.quantity.milli)}
        >
          Agregar <kbd>Enter</kbd>
        </button>
      </div>
    </dialog>
  );
}
