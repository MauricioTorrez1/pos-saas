import { useState, type ReactElement } from 'react';

import type { PosApi } from '../../shared/pos-api';
import type { CreateProductResult, ProductAdminApi, ProductDetail } from '../../shared/product-admin';
import { Field, Message, useAction } from '../ui/form-parts';
import { ModalDialog } from '../ui/ModalDialog';
import { useWindowKeys } from '../ui/use-window-keys';
import { ProductFields } from './ProductFields';
import { readNewProductForm, type ProductFormProblems, type ProductFormValues } from './product-form';

/** What to tell the person for each way adding a product can be refused. The `created` case is not here: it closes the dialog. */
function describeRefusal(result: Exclude<CreateProductResult, { status: 'created' }>): string {
  switch (result.status) {
    case 'duplicate_code':
      return `El código ${result.code} ya lo usa «${result.productName}». Quítalo de la lista o corrige ese producto.`;
    case 'authorization_required':
      return 'Pídele al dueño que escriba su PIN.';
    case 'wrong_pin':
      return `PIN del dueño incorrecto. Quedan ${result.attemptsLeft} intentos. Quedó anotado en la bitácora.`;
    case 'locked':
      return 'Demasiados intentos con el PIN del dueño. Espera unos minutos. Quedó anotado en la bitácora.';
  }
}

interface NewProductDialogProps {
  readonly posApi: PosApi;
  readonly productApi: ProductAdminApi;
  /** The owner needs no PIN, and a cashier has to type the one of an owner. */
  readonly isOwner: boolean;
  /** What the boxes hold when the dialog opens, such as the code that was just scanned. */
  readonly initialValues: ProductFormValues;
  /** Called after the product was created, with the product as it is now. */
  readonly onCreated: (product: ProductDetail) => void;
  readonly onCancel: () => void;
}

/**
 * Adds a product that is not in the catalog (E1-42), such as something a customer brings that the import from Eleventa did
 * not have. The form checks what it can, and the main process checks it again. F2 saves and Esc cancels, like every dialog
 * of the register. A cashier has to type the PIN of the owner, and every refused attempt stays in the audit log.
 *
 * @param props.posApi bridge to the main process, to look for codes that are already taken
 * @param props.productApi bridge that adds the product
 * @param props.isOwner whether the person at the register is the owner
 * @param props.initialValues what the boxes hold at the start
 * @param props.onCreated called once the product is saved
 * @param props.onCancel called when the person gives up
 * @returns the dialog
 */
export function NewProductDialog({ posApi, productApi, isOwner, initialValues, onCreated, onCancel }: NewProductDialogProps): ReactElement {
  const [values, setValues] = useState<ProductFormValues>(initialValues);
  const [problems, setProblems] = useState<ProductFormProblems>({});
  const [pin, setPin] = useState('');
  const { isBusy, message, setMessage, run } = useAction();

  const change = (patch: Partial<ProductFormValues>): void => {
    setValues((previous) => ({ ...previous, ...patch }));
    setProblems((previous) => withoutBoxes(previous, patch));
    setMessage(null);
  };

  const findCodeOwner = async (code: string): Promise<string | null> => (await posApi.findProductByCode(code))?.name ?? null;

  const save = (): void => {
    const reading = readNewProductForm(values);
    if (!reading.ok) {
      setProblems(reading.problems);
      setMessage('Revisa lo marcado en rojo.');
      return;
    }
    if (!isOwner && pin === '') {
      setMessage('Pídele al dueño que escriba su PIN.');
      return;
    }
    run(async () => {
      const result = await productApi.createProduct({ ...reading.request, ...(isOwner ? {} : { ownerPin: pin }) });
      if (result.status === 'created') {
        onCreated(result.product);
        return;
      }
      setPin('');
      setMessage(describeRefusal(result));
    });
  };

  useWindowKeys({ F2: save, Escape: onCancel }, isBusy);

  return (
    <ModalDialog titleId="new-product-title" className="cash">
      <h2 id="new-product-title">Producto nuevo</h2>
      <p>Da de alta lo que no está en el catálogo. Queda guardado con tu nombre y se puede vender de inmediato, aunque no haya internet.</p>
      <ProductFields values={values} problems={problems} onChange={change} findCodeOwner={findCodeOwner} />
      {!isOwner && <Field label="PIN del dueño" value={pin} onChange={setPin} type="password" maxLength={8} />}
      <Message text={message} />
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={onCancel}>
          Cancelar <kbd>Esc</kbd>
        </button>
        <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy} onClick={save}>
          Guardar producto <kbd>F2</kbd>
        </button>
      </div>
    </ModalDialog>
  );
}

/** Clears the problem of every box the person just touched. Changing the unit also clears the stock, which depends on it. */
function withoutBoxes(problems: ProductFormProblems, patch: Partial<ProductFormValues>): ProductFormProblems {
  const kept: { -readonly [Box in keyof ProductFormProblems]: ProductFormProblems[Box] } = { ...problems };
  for (const box of Object.keys(patch)) {
    delete kept[(box === 'unit' ? 'stock' : box) as keyof ProductFormProblems];
  }
  return kept;
}
