import { MoneyError, parseQuantity, parseUnitPriceE4 } from '@pos-saas/money';
import { useState, type ReactElement } from 'react';

import { MAX_MISC_NAME_LENGTH } from '../../shared/miscellaneous';
import { Field, Message } from '../ui/form-parts';
import { ModalDialog } from '../ui/ModalDialog';
import { useWindowKeys } from '../ui/use-window-keys';

/** What the cashier typed for a miscellaneous item, already read. */
export interface MiscItem {
  readonly name: string;
  readonly unitPriceE4: number;
  readonly quantityMilli: number;
  /** The PIN of the owner, when a cashier is selling it. */
  readonly ownerPin?: string;
}

interface MiscItemDialogProps {
  /** The owner needs no PIN, and a cashier has to type the one of the owner. */
  readonly isOwner: boolean;
  readonly onAdd: (item: MiscItem) => void;
  readonly onCancel: () => void;
}

/**
 * Asks for what is sold when it is not in the catalog: what it is, how much each costs and how many (RF-003). The price
 * is whatever is typed, so the owner approves it, with their sign-in or, for a cashier, with their PIN.
 *
 * @param props.isOwner whether the person selling is the owner
 * @param props.onAdd called with the item once it reads well
 * @param props.onCancel called when the cashier gives up
 * @returns the dialog
 */
export function MiscItemDialog({ isOwner, onAdd, onCancel }: MiscItemDialogProps): ReactElement {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [pin, setPin] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const submit = (): void => {
    try {
      const unitPriceE4 = parseUnitPriceE4(price);
      const quantityMilli = parseQuantity(quantity, 'piece').milli;
      if (name.trim() === '') {
        setMessage('Escribe qué es, para que salga en el ticket.');
      } else if (unitPriceE4 <= 0) {
        setMessage('El precio debe ser mayor que cero.');
      } else if (quantityMilli <= 0) {
        setMessage('La cantidad debe ser al menos una pieza.');
      } else if (!isOwner && pin === '') {
        setMessage('Pídele al dueño que escriba su PIN.');
      } else {
        onAdd({ name: name.trim(), unitPriceE4, quantityMilli, ...(isOwner ? {} : { ownerPin: pin }) });
      }
    } catch (error) {
      setMessage(error instanceof MoneyError ? 'Revisa el precio y la cantidad: solo números, y la cantidad es en piezas enteras.' : 'No se pudo leer lo que escribiste.');
    }
  };

  useWindowKeys({ F2: submit, Escape: onCancel });

  return (
    <ModalDialog titleId="misc-title" className="cash">
      <h2 id="misc-title">Artículo varios</h2>
      <p>Para algo que no está en el catálogo. El precio lleva el IVA incluido, y queda anotado quién lo aprobó.</p>
      <Field label="Qué es" value={name} onChange={setName} autoFocus maxLength={MAX_MISC_NAME_LENGTH} />
      <Field label="Precio de cada uno" value={price} onChange={setPrice} maxLength={12} hint="En pesos, por ejemplo 12.50" />
      <Field label="Cantidad" value={quantity} onChange={setQuantity} maxLength={6} />
      {!isOwner && <Field label="PIN del dueño" value={pin} onChange={setPin} type="password" maxLength={8} />}
      <Message text={message} />
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={onCancel}>
          Cancelar <kbd>Esc</kbd>
        </button>
        <button type="button" className="button button-primary" tabIndex={-1} onClick={submit}>
          Agregar <kbd>F2</kbd>
        </button>
      </div>
    </ModalDialog>
  );
}
