import { useEffect, useState, type ReactElement } from 'react';

import type { ProductAdminApi, ProductPanelDetail, ReactivateProductResult, ReactivationPreview } from '../../shared/product-admin';
import { CheckField, Field, Message, useAction } from '../ui/form-parts';
import { Modal } from '../ui/Modal';

/** What to tell the person for each way reactivating can end without writing. */
function describeResult(result: Exclude<ReactivateProductResult, { status: 'reactivated' }>): string {
  switch (result.status) {
    case 'not_found':
      return 'El producto ya no está en el catálogo.';
    case 'already_active':
      return 'Este producto ya está a la venta.';
    case 'stale':
      return 'El producto cambió mientras lo veías. Ya cargué cómo está ahora: revisa y vuelve a intentar.';
    case 'code_taken':
      return `El código ${result.code} ya lo usa «${result.productName}». Desmárcalo para reactivar sin él.`;
    case 'name_taken':
      return `Ya hay un producto a la venta llamado «${result.productName}». Escribe otro nombre para no confundirlos.`;
    case 'authorization_required':
      return 'Pídele al dueño que escriba su PIN.';
    case 'wrong_pin':
      return `PIN del dueño incorrecto. Quedan ${result.attemptsLeft} intentos. Quedó anotado en la bitácora.`;
    case 'locked':
      return 'Demasiados intentos con el PIN del dueño. Espera unos minutos. Quedó anotado en la bitácora.';
  }
}

/** The codes that are still free, which come back unless the owner unticks them. */
function freeCodesOf(preview: ReactivationPreview): Set<string> {
  return new Set(preview.releasedCodes.filter(({ takenBy }) => takenBy === null).map(({ code }) => code));
}

interface ReactivateProductDialogProps {
  readonly productApi: ProductAdminApi;
  readonly productId: string;
  /** The owner needs no PIN, and a cashier has to type the one of an owner. */
  readonly isOwner: boolean;
  readonly onReactivated: (product: ProductPanelDetail) => void;
  readonly onCancel: () => void;
}

/**
 * Puts a given-up product on sale again (E1-62, ADR 0081). It lists the codes the product released: the free ones come back
 * ticked, and one that another product uses now is shown with its owner and cannot be ticked, because a code is never taken
 * from another product. When an active product already has the name, it asks for another one. F2 reactivates and Esc gives up.
 *
 * @param props.productApi bridge that reads and reactivates products
 * @param props.productId the product to reactivate
 * @param props.isOwner whether the person at the register is the owner
 * @param props.onReactivated called with the product once it is on sale again
 * @param props.onCancel called when the person gives up
 * @returns the dialog
 */
export function ReactivateProductDialog({ productApi, productId, isOwner, onReactivated, onCancel }: ReactivateProductDialogProps): ReactElement {
  const [preview, setPreview] = useState<ReactivationPreview | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const { isBusy, message, setMessage, run } = useAction();

  const load = (): void =>
    run(async () => {
      const loaded = await productApi.previewReactivation(productId);
      if (loaded === null) {
        setMessage('El producto ya no está en el catálogo.');
        return;
      }
      setPreview(loaded);
      setChosen(freeCodesOf(loaded));
      setName(loaded.name);
    });

  useEffect(load, []);

  const toggle = (code: string, isChosen: boolean): void => {
    setChosen((previous) => {
      const next = new Set(previous);
      if (isChosen) {
        next.add(code);
      } else {
        next.delete(code);
      }
      return next;
    });
  };

  const reactivate = (): void => {
    if (preview === null || isBusy) {
      return;
    }
    if (name.trim() === '') {
      setMessage('Escribe el nombre del producto.');
      return;
    }
    if (!isOwner && pin === '') {
      setMessage('Pídele al dueño que escriba su PIN.');
      return;
    }
    run(async () => {
      const result = await productApi.reactivateProduct({
        productId: preview.productId,
        expectedRevision: preview.revision,
        name: name.trim(),
        restoreCodes: preview.releasedCodes.map(({ code }) => code).filter((code) => chosen.has(code)),
        ...(isOwner ? {} : { ownerPin: pin }),
      });
      if (result.status === 'reactivated') {
        onReactivated(result.product);
        return;
      }
      setPin('');
      setMessage(describeResult(result));
      if (result.status === 'stale' || result.status === 'code_taken') {
        const reloaded = await productApi.previewReactivation(productId);
        if (reloaded !== null) {
          setPreview(reloaded);
          setChosen(freeCodesOf(reloaded));
        }
      }
    });
  };

  const nameIsTaken = preview?.nameTakenBy != null && name.trim().toLocaleLowerCase('es-MX') === preview.name.trim().toLocaleLowerCase('es-MX');

  return (
    <Modal
      title={preview === null ? 'Reactivar producto' : `Reactivar ${preview.name}`}
      className="cash"
      onClose={onCancel}
      onKey={(event) => {
        if (event.key === 'F2') {
          reactivate();
          return true;
        }
        return false;
      }}
    >
      {preview !== null && (
        <>
          <p>Vuelve a salir en la venta con su precio, su existencia y su historial.</p>
          {preview.nameTakenBy !== null && (
            <p className="notice notice-warn" role="status">
              Ya hay un producto a la venta llamado «{preview.nameTakenBy.productName}». Ponle otro nombre a este para no confundirlos.
            </p>
          )}
          <Field
            label="Nombre"
            value={name}
            onChange={(text) => {
              setName(text);
              setMessage(null);
            }}
            autoFocus
            maxLength={200}
            {...(nameIsTaken ? { problem: 'Este nombre ya lo tiene otro producto a la venta.' } : {})}
          />
          {preview.releasedCodes.length === 0 ? (
            <p>No tiene códigos guardados: puedes agregarle uno en el panel después de reactivarlo.</p>
          ) : (
            <fieldset aria-label="Códigos que liberó">
              <legend>Códigos que liberó al darse de baja</legend>
              {preview.releasedCodes.map(({ code, takenBy }) =>
                takenBy === null ? (
                  <CheckField key={code} label={`Recuperar ${code}`} checked={chosen.has(code)} onChange={(isChosen) => toggle(code, isChosen)} />
                ) : (
                  <p key={code} className="notice notice-warn">
                    <code>{code}</code> ya lo usa «{takenBy.productName}». Se reactiva sin este código: no se le quita al otro producto.
                  </p>
                ),
              )}
            </fieldset>
          )}
          {!isOwner && <Field label="PIN del dueño" numeric="integer" value={pin} onChange={setPin} type="password" maxLength={8} />}
        </>
      )}
      <Message text={message} />
      <div className="payment-actions">
        <button type="button" className="button" tabIndex={-1} onClick={onCancel}>
          Cancelar <kbd>Esc</kbd>
        </button>
        <button type="button" className="button button-primary" tabIndex={-1} disabled={isBusy || preview === null} onClick={reactivate}>
          Reactivar <kbd>F2</kbd>
        </button>
      </div>
    </Modal>
  );
}
