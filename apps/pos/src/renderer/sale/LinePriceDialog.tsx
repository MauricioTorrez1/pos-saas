import { formatCents, formatUnitPriceE4, lineTotals, MoneyError } from '@pos-saas/money';
import { useState, type ReactElement } from 'react';

import { readNewPrice } from '../pricing/price-input';
import { Field } from '../ui/form-parts';
import { Modal } from '../ui/Modal';
import type { SaleLine } from './sale-state';

interface LinePriceDialogProps {
  /** The line whose price changes. */
  readonly line: SaleLine;
  /** Called with the price to charge on this sale, in ten-thousandths of a peso. */
  readonly onConfirm: (unitPriceE4: number) => void;
  readonly onCancel: () => void;
}

/**
 * Changes the price of one line for this sale only. The shelf said one price and the register another: the cashier
 * charges what the customer saw and goes on, and the catalog keeps its price until the owner fixes it from the panel
 * of the product.
 *
 * @param props.line the line whose price changes
 * @param props.onConfirm called with the price to charge
 * @param props.onCancel called when the cashier gives up
 * @returns the dialog
 */
export function LinePriceDialog({ line, onConfirm, onCancel }: LinePriceDialogProps): ReactElement {
  const [text, setText] = useState('');
  const [showProblem, setShowProblem] = useState(false);
  const reading = readNewPrice(text);
  const catalogPriceE4 = line.catalogPriceE4 ?? line.product.unitPriceE4;
  const isOverridden = line.catalogPriceE4 !== undefined;

  let amount: string | null = null;
  if (reading.ok) {
    try {
      amount = formatCents(lineTotals(reading.unitPriceE4, line.quantity, line.product.taxRate).totalCents);
    } catch (error) {
      if (!(error instanceof MoneyError)) {
        throw error;
      }
    }
  }

  const confirm = (): void => {
    if (reading.ok && amount !== null) {
      onConfirm(reading.unitPriceE4);
    } else {
      setShowProblem(true);
    }
  };

  return (
    <Modal
      title={`Precio de ${line.product.name}`}
      className="line-price"
      onClose={onCancel}
      onKey={(event) => {
        if (event.key === 'F2') {
          confirm();
          return true;
        }
        return false;
      }}
    >
      <p className="quantity-price">
        Precio del catálogo: <strong>{formatUnitPriceE4(catalogPriceE4)}</strong>
        {isOverridden && <> · en esta venta: {formatUnitPriceE4(line.product.unitPriceE4)}</>}
      </p>
      <Field
        label="Precio para esta venta (IVA incluido)"
        numeric="decimal"
        value={text}
        onChange={(value) => {
          setText(value);
          setShowProblem(false);
        }}
        autoFocus
        maxLength={14}
        onEnter={confirm}
        hint="En pesos, por ejemplo 135.50"
        problem={showProblem && !reading.ok ? reading.message : showProblem && amount === null ? 'El importe es demasiado grande. Revisa el precio.' : undefined}
      />
      <p className="payment-total">
        <span>Importe de la línea</span>
        <output aria-label="Importe con el precio nuevo">{amount ?? '—'}</output>
      </p>
      <p className="notice notice-info">
        Solo cambia el precio de este producto en esta venta. El catálogo conserva su precio: para cambiarlo para siempre, abre el producto.
      </p>
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={onCancel}>
          Cancelar <kbd>Esc</kbd>
        </button>
        {isOverridden && (
          <button type="button" className="button" tabIndex={-1} onClick={() => onConfirm(catalogPriceE4)}>
            Volver al precio del catálogo
          </button>
        )}
        <button type="button" className="button button-primary" tabIndex={-1} onClick={confirm}>
          Cobrar a este precio <kbd>Enter</kbd>
        </button>
      </div>
    </Modal>
  );
}
