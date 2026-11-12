import { UNITS, type TaxRate, type Unit } from '@pos-saas/money';
import { useState, type ReactElement } from 'react';

import { problemWithBarcode } from '../../shared/product-admin';
import { formatTaxLabel } from '../sale/format';
import { CheckField, Field, SelectField } from '../ui/form-parts';
import { offeredTaxRates, taxKeyOf, type ProductFormProblems, type ProductFormValues } from './product-form';

const UNIT_NAMES: Readonly<Record<Unit, string>> = {
  piece: 'Pieza',
  meter: 'Metro',
  kilogram: 'Kilo',
  liter: 'Litro',
};

const STOCK_HINTS: Readonly<Record<Unit, string>> = {
  piece: 'En piezas enteras.',
  meter: 'En metros, hasta 3 decimales.',
  kilogram: 'En kilos, hasta 3 decimales.',
  liter: 'En litros, hasta 3 decimales.',
};

interface ProductFieldsProps {
  readonly values: ProductFormValues;
  readonly problems: ProductFormProblems;
  readonly onChange: (patch: Partial<ProductFormValues>) => void;
  /**
   * Looks for another product that already uses a code, so the person hears it as soon as the code is scanned and not when
   * saving. The product being edited does not count against itself.
   *
   * @returns the name of the product that has the code, or null if it is free
   */
  readonly findCodeOwner: (code: string) => Promise<string | null>;
  /** Shows the price box. The panel hides it because the price changes in its own flow (E1-39). */
  readonly showPrice?: boolean;
  /** Shows the box for the stock the shelf has now. Only a new product has it: afterwards the stock moves with adjustments. */
  readonly showStock?: boolean;
  /** Why the unit cannot change, or undefined if it can. */
  readonly unitLockedReason?: string | undefined;
  /** The rate the product already has, offered even if it is not one of the usual ones. */
  readonly currentTaxRate?: TaxRate;
  /** The label of the box that says whether the product is sold. */
  readonly activeLabel?: string;
}

/**
 * The boxes of a product, shared by the form of a new product (E1-42) and the panel that edits one (E1-43), so the two ask
 * the same things in the same words and follow the same rules. The barcode box takes a scanner: it ends every code with
 * Enter, which adds the code to the list and leaves the box ready for the next one.
 *
 * @param props.values what the boxes hold
 * @param props.problems what is wrong, to show under each box
 * @param props.onChange called with the box that changed
 * @param props.findCodeOwner looks for another product with a code
 * @returns the boxes
 */
export function ProductFields({
  values,
  problems,
  onChange,
  findCodeOwner,
  showPrice = true,
  showStock = true,
  unitLockedReason,
  currentTaxRate,
  activeLabel = 'A la venta',
}: ProductFieldsProps): ReactElement {
  const [codeText, setCodeText] = useState('');
  const [codeProblem, setCodeProblem] = useState<string | undefined>(undefined);

  const addCode = async (): Promise<void> => {
    const code = codeText.trim();
    if (code === '') {
      return;
    }
    const problem = problemWithBarcode(code);
    if (problem !== null) {
      setCodeProblem(problem);
      return;
    }
    if (values.barcodes.includes(code)) {
      setCodeProblem(`El código ${code} ya está en la lista.`);
      return;
    }
    const owner = await findCodeOwner(code);
    if (owner !== null) {
      setCodeProblem(`El código ${code} ya lo usa «${owner}».`);
      return;
    }
    onChange({ barcodes: [...values.barcodes, code] });
    setCodeText('');
    setCodeProblem(undefined);
  };

  const removeCode = (code: string): void => onChange({ barcodes: values.barcodes.filter((existing) => existing !== code) });

  return (
    <div className="product-form">
      <Field label="Nombre" value={values.name} onChange={(name) => onChange({ name })} autoFocus maxLength={200} problem={problems.name} />
      <div className="product-form-row">
        <SelectField
          label="Unidad de medida"
          value={values.unit}
          onChange={(unit) => onChange({ unit })}
          options={UNITS.map((unit) => ({ value: unit, label: UNIT_NAMES[unit] }))}
          disabled={unitLockedReason !== undefined}
          {...(unitLockedReason === undefined ? {} : { hint: unitLockedReason })}
        />
        <SelectField
          label="IVA"
          value={values.taxKey}
          onChange={(taxKey) => onChange({ taxKey })}
          options={offeredTaxRates(currentTaxRate).map((rate) => ({ value: taxKeyOf(rate), label: formatTaxLabel(rate) }))}
        />
      </div>
      <div className="product-form-row">
        {showPrice && (
          <Field label="Precio (IVA incluido)" value={values.price} onChange={(price) => onChange({ price })} maxLength={14} hint="En pesos, por ejemplo 135.50" problem={problems.price} />
        )}
        <Field label="Costo (opcional)" value={values.cost} onChange={(cost) => onChange({ cost })} maxLength={16} hint="Lo que te cuesta cada unidad, sin IVA." problem={problems.cost} />
      </div>
      <Field
        label="Código de barras"
        value={codeText}
        onChange={(text) => {
          setCodeText(text);
          setCodeProblem(undefined);
        }}
        maxLength={64}
        onEnter={() => void addCode()}
        hint="Escanea el código o escríbelo y oprime Enter. Puedes agregar varios."
        problem={codeProblem ?? problems.barcodes}
      />
      {values.barcodes.length > 0 && (
        <ul className="product-codes" aria-label="Códigos del producto">
          {values.barcodes.map((code) => (
            <li key={code}>
              <code>{code}</code>
              <button type="button" className="product-code-remove" tabIndex={-1} aria-label={`Quitar el código ${code}`} onClick={() => removeCode(code)}>
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
      {showStock && (
        <Field label="Existencia inicial (opcional)" value={values.stock} onChange={(stock) => onChange({ stock })} maxLength={12} hint={`Lo que hay en el estante ahora. ${STOCK_HINTS[values.unit]}`} problem={problems.stock} />
      )}
      <CheckField label={activeLabel} checked={values.isActive} onChange={(isActive) => onChange({ isActive })} />
    </div>
  );
}
