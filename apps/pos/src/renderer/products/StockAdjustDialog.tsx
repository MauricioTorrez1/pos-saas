import { MoneyError, parseQuantity, type Unit } from '@pos-saas/money';
import { useState, type ReactElement } from 'react';

import type { AdjustStockResult } from '../../shared/inventory-api';
import type { PosApi } from '../../shared/pos-api';
import { STOCK_KINDS, type StockKind } from '../admin/stock-kinds';
import { unitLabel } from '../sale/format';
import { Field, Message, SelectField, useAction } from '../ui/form-parts';
import { ModalDialog } from '../ui/ModalDialog';
import { useWindowKeys } from '../ui/use-window-keys';

/** What to tell the person for each way an adjustment can be refused. The `recorded` case is not here: it closes the dialog. */
function describeRefusal(result: Exclude<AdjustStockResult, { status: 'recorded' }>): string {
  switch (result.status) {
    case 'not_found':
      return 'El producto ya no está en el catálogo.';
    case 'waste_must_be_negative':
      return 'Una merma siempre saca existencia.';
    case 'authorization_required':
      return 'Pídele al dueño que escriba su PIN.';
    case 'wrong_pin':
      return `PIN del dueño incorrecto. Quedan ${result.attemptsLeft} intentos. Quedó anotado en la bitácora.`;
    case 'locked':
      return 'Demasiados intentos con el PIN del dueño. Espera unos minutos. Quedó anotado en la bitácora.';
  }
}

interface StockAdjustDialogProps {
  readonly posApi: PosApi;
  readonly productId: string;
  readonly productName: string;
  readonly unit: Unit;
  /** The owner needs no PIN, and a cashier has to type the one of an owner. */
  readonly isOwner: boolean;
  /** Called after the movement was written to the ledger. */
  readonly onAdjusted: () => void;
  readonly onCancel: () => void;
}

/**
 * Corrects a count or writes off a loss from the product panel (E1-43), with the same service as the inventory of the
 * administration (E1-26): the stock is never typed, it only moves with a movement of the ledger that has its reason. A
 * cashier has to type the PIN of the owner, and every refused attempt stays in the audit log.
 *
 * @param props.posApi bridge to the main process
 * @param props.productId the product whose stock moves
 * @param props.productName its name, to show what is being adjusted
 * @param props.unit its unit, which the quantity is read in
 * @param props.isOwner whether the person at the register is the owner
 * @param props.onAdjusted called once the movement is written
 * @param props.onCancel called when the person gives up
 * @returns the dialog
 */
export function StockAdjustDialog({ posApi, productId, productName, unit, isOwner, onAdjusted, onCancel }: StockAdjustDialogProps): ReactElement {
  const [kind, setKind] = useState<StockKind>('waste');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  const [pin, setPin] = useState('');
  const { isBusy, message, setMessage, run } = useAction();

  const save = (): void => {
    let milli: number;
    try {
      milli = parseQuantity(quantity, unit).milli;
    } catch (error) {
      setMessage(error instanceof MoneyError ? 'La cantidad no es válida. Usa números, con hasta 3 decimales (las piezas son enteras).' : 'No se pudo leer la cantidad.');
      return;
    }
    if (milli === 0) {
      setMessage('La cantidad debe ser mayor que cero.');
      return;
    }
    if (reason.trim() === '') {
      setMessage('Escribe el motivo: se queda guardado en la bitácora.');
      return;
    }
    if (!isOwner && pin === '') {
      setMessage('Pídele al dueño que escriba su PIN.');
      return;
    }
    const { type, sign } = STOCK_KINDS[kind];
    run(async () => {
      const result = await posApi.adjustStock({ productId, type, quantityMilli: sign * milli, reason, ...(isOwner ? {} : { ownerPin: pin }) });
      if (result.status === 'recorded') {
        onAdjusted();
        return;
      }
      setPin('');
      setMessage(describeRefusal(result));
    });
  };

  useWindowKeys({ F2: save, Escape: onCancel }, isBusy);

  return (
    <ModalDialog titleId="stock-adjust-title" className="cash">
      <h2 id="stock-adjust-title">Ajustar existencia</h2>
      <p className="quantity-price">
        <strong>{productName}</strong> · cantidades en {unitLabel(unit)}
      </p>
      <SelectField
        label="Qué pasó"
        value={kind}
        onChange={setKind}
        options={(Object.keys(STOCK_KINDS) as StockKind[]).map((key) => ({ value: key, label: STOCK_KINDS[key].label }))}
      />
      <Field label="Cantidad" value={quantity} onChange={setQuantity} autoFocus maxLength={12} hint="Sin signo: la caja lo pone según lo que elegiste." />
      <Field label="Motivo" value={reason} onChange={setReason} maxLength={200} />
      {!isOwner && <Field label="PIN del dueño" value={pin} onChange={setPin} type="password" maxLength={8} />}
      <Message text={message} />
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={onCancel}>
          Cancelar <kbd>Esc</kbd>
        </button>
        <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={save}>
          Registrar <kbd>F2</kbd>
        </button>
      </div>
    </ModalDialog>
  );
}
