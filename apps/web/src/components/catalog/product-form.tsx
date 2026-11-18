'use client';

import { startTransition, useActionState, useState, type FormEvent } from 'react';
import { EMPTY_PRODUCT_FORM, type ProductFormState } from '@/lib/catalog/action-state';
import { TAX_OPTIONS, type ProductFormInput } from '@/lib/catalog/product-form';
import { UNITS, UNIT_LABELS } from '@/lib/catalog/types';

interface ProductFormProps {
  /** Server Action that saves the form. */
  action: (previous: ProductFormState, data: FormData) => Promise<ProductFormState>;
  initial: ProductFormInput;
  mode: 'create' | 'edit';
  /** Whether to show the price field: only on creation, and only for who may set prices. */
  showPrice: boolean;
  /** UUIDv7 rendered by the page, sent as `Idempotency-Key` on creation. */
  idempotencyKey?: string;
}

interface PresentationRow {
  id: number;
  name: string;
  quantity: string;
}

function FieldError({ id, message }: { id: string; message: string | undefined }) {
  return message ? (
    <p id={id} className="field__error" role="alert">
      {message}
    </p>
  ) : null;
}

/**
 * The form to create or edit a product.
 *
 * It submits with `startTransition` instead of `<form action>`, because React resets a form after its action and
 * the owner would lose what they typed when the core rejects one field. The checks of `parseProductForm` run in the
 * Server Action, next to the call to the core, so there is one set of rules.
 */
export function ProductForm({ action, initial, mode, showPrice, idempotencyKey }: ProductFormProps) {
  const [state, formAction, pending] = useActionState(action, EMPTY_PRODUCT_FORM);
  const [rows, setRows] = useState<PresentationRow[]>(() =>
    initial.presentationNames.map((name, index) => ({
      id: index,
      name,
      quantity: initial.presentationQuantities[index] ?? '',
    })),
  );
  const [nextRowId, setNextRowId] = useState(initial.presentationNames.length);
  const errors = state.errors;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  function addRow() {
    setRows((current) => [...current, { id: nextRowId, name: '', quantity: '' }]);
    setNextRowId((id) => id + 1);
  }

  const described = (field: keyof ProductFormState['errors']) => (errors[field] ? `${field}-error` : undefined);

  return (
    <form className="form" onSubmit={submit} noValidate aria-busy={pending}>
      {idempotencyKey && <input type="hidden" name="idempotencyKey" value={idempotencyKey} />}
      {state.message && (
        <p className="notice notice--danger" role="alert">
          {state.message}
        </p>
      )}

      <div className="field">
        <label htmlFor="name">Nombre</label>
        <input
          id="name"
          name="name"
          defaultValue={initial.name}
          maxLength={200}
          autoComplete="off"
          aria-invalid={Boolean(errors.name)}
          aria-describedby={described('name')}
          autoFocus={mode === 'create'}
        />
        <FieldError id="name-error" message={errors.name} />
      </div>

      <div className="form__row">
        <div className="field">
          <label htmlFor="unit">Se vende por</label>
          <select id="unit" name="unit" defaultValue={initial.unit} aria-invalid={Boolean(errors.unit)}>
            {UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {UNIT_LABELS[unit]}
              </option>
            ))}
          </select>
          <FieldError id="unit-error" message={errors.unit} />
        </div>
        <div className="field">
          <label htmlFor="tax">IVA</label>
          <select id="tax" name="tax" defaultValue={initial.tax} aria-invalid={Boolean(errors.tax)}>
            {TAX_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <FieldError id="tax-error" message={errors.tax} />
        </div>
        {mode === 'edit' && (
          <div className="field">
            <label htmlFor="status">Estado</label>
            <select id="status" name="status" defaultValue={initial.status}>
              <option value="active">Activo: se vende</option>
              <option value="inactive">Inactivo: no aparece en la caja</option>
            </select>
          </div>
        )}
      </div>

      {showPrice && (
        <div className="field field--narrow">
          <label htmlFor="unitPrice">Precio de venta con IVA</label>
          <input
            id="unitPrice"
            name="unitPrice"
            defaultValue={initial.unitPrice ?? ''}
            inputMode="decimal"
            placeholder="0.00"
            aria-invalid={Boolean(errors.unitPrice)}
            aria-describedby={described('unitPrice') ?? 'unitPrice-hint'}
          />
          <p id="unitPrice-hint" className="field__hint">
            Por unidad. Hasta 4 decimales para precios por metro o por kilo.
          </p>
          <FieldError id="unitPrice-error" message={errors.unitPrice} />
        </div>
      )}

      <div className="form__row">
        <div className="field">
          <label htmlFor="barcodes">Códigos de barras</label>
          <textarea
            id="barcodes"
            name="barcodes"
            rows={3}
            defaultValue={initial.barcodes}
            className="mono"
            aria-invalid={Boolean(errors.codes)}
            aria-describedby="codes-hint"
          />
        </div>
        <div className="field">
          <label htmlFor="alternates">Claves propias de la tienda</label>
          <textarea
            id="alternates"
            name="alternates"
            rows={3}
            defaultValue={initial.alternates}
            className="mono"
            aria-invalid={Boolean(errors.codes)}
            aria-describedby="codes-hint"
          />
        </div>
      </div>
      <p id="codes-hint" className="field__hint">
        Uno por renglón. Puedes escanearlos aquí con el lector.
      </p>
      <FieldError id="codes-error" message={errors.codes} />

      <fieldset className="field fieldset">
        <legend>Presentaciones a granel</legend>
        <p className="field__hint">Por ejemplo, «Rollo» de 100 metros o «Caja» de 50 piezas.</p>
        {rows.map((row, index) => (
          <div className="form__row form__row--tight" key={row.id}>
            <input
              name="presentationName"
              aria-label={`Nombre de la presentación ${index + 1}`}
              defaultValue={row.name}
              placeholder="Rollo"
            />
            <input
              name="presentationQuantity"
              aria-label={`Unidades de la presentación ${index + 1}`}
              defaultValue={row.quantity}
              inputMode="decimal"
              placeholder="100"
            />
            <button
              type="button"
              className="button button--quiet"
              onClick={() => setRows((current) => current.filter((candidate) => candidate.id !== row.id))}
            >
              Quitar
            </button>
          </div>
        ))}
        <button type="button" className="button button--quiet" onClick={addRow}>
          Agregar presentación
        </button>
        <FieldError id="presentations-error" message={errors.presentations} />
      </fieldset>

      <div className="form__row">
        <div className="field">
          <label htmlFor="satProductKey">Clave de producto SAT</label>
          <input
            id="satProductKey"
            name="satProductKey"
            defaultValue={initial.satProductKey}
            inputMode="numeric"
            maxLength={8}
            placeholder="31161500"
            className="mono"
            aria-invalid={Boolean(errors.satProductKey)}
          />
          <FieldError id="satProductKey-error" message={errors.satProductKey} />
        </div>
        <div className="field">
          <label htmlFor="satUnitKey">Clave de unidad SAT</label>
          <input
            id="satUnitKey"
            name="satUnitKey"
            defaultValue={initial.satUnitKey}
            maxLength={3}
            placeholder="H87"
            className="mono"
            aria-invalid={Boolean(errors.satUnitKey)}
          />
          <FieldError id="satUnitKey-error" message={errors.satUnitKey} />
        </div>
      </div>
      <p className="field__hint">Las dos claves SAT son necesarias para facturar el producto.</p>

      <div className="form__actions">
        <button type="submit" className="button" disabled={pending}>
          {pending ? 'Guardando…' : mode === 'create' ? 'Crear producto' : 'Guardar cambios'}
        </button>
      </div>
    </form>
  );
}
