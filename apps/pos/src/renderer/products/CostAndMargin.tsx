import { formatCents, type TaxRate } from '@pos-saas/money';
import { useState, type ReactElement } from 'react';

import { formatUnitCost, readUnitCost } from '../../shared/product-admin';
import { readNewPrice } from '../pricing/price-input';
import { Field } from '../ui/form-parts';
import { keepNumeric } from '../ui/numeric';
import { costWithoutTaxText, costWithTaxText, markupText, priceForMarkup } from './product-form';

const SLIDER_MAX = 200;
const E4_PER_CENT = 100;
const E6_PER_CENT = 10_000;

interface CostAndMarginProps {
  /** The cost without VAT, as the form keeps it. */
  readonly cost: string;
  /** The price with VAT being typed, or the price the product already has when the price is not edited here. */
  readonly price: string;
  readonly taxRate: TaxRate;
  /** Called with the cost without VAT whenever the cost with VAT changes. */
  readonly onCostChange: (cost: string) => void;
  /** Called with the price that earns the percentage the person asked for. Without it, the price is only shown. */
  readonly onPriceChange?: (price: string) => void;
  readonly costProblem?: string | undefined;
  readonly priceProblem?: string | undefined;
}

/**
 * The cost and what is earned over it. The person types the cost as the supplier charges it, with VAT, and the cost
 * without VAT is worked out and shown. Moving the percentage sets the price, and typing the price shows the
 * percentage, so the owner sees at once what a price leaves.
 *
 * @param props.cost the cost without VAT that the form keeps
 * @param props.price the price with VAT
 * @param props.taxRate the VAT of the product
 * @param props.onCostChange called with the cost without VAT
 * @param props.onPriceChange called with the price worked out from the percentage
 * @param props.costProblem what is wrong with the cost, if anything
 * @param props.priceProblem what is wrong with the price, if anything
 * @returns the boxes of the cost, the percentage and the price
 */
export function CostAndMargin({ cost, price, taxRate, onCostChange, onPriceChange, costProblem, priceProblem }: CostAndMarginProps): ReactElement {
  const [withTax, setWithTax] = useState(() => costWithTaxText(cost, taxRate));
  const [markup, setMarkup] = useState(() => markupText(price, costWithTaxText(cost, taxRate)));
  const [seenRate, setSeenRate] = useState(taxRate);

  // The cost the supplier charges does not change with the VAT of the product, so the cost without VAT is worked out again.
  if (seenRate.factor !== taxRate.factor || seenRate.rateBp !== taxRate.rateBp) {
    setSeenRate(taxRate);
    const without = costWithoutTaxText(withTax, taxRate);
    if (without !== null && without !== cost) {
      onCostChange(without);
    }
  }

  const changeCost = (text: string): void => {
    setWithTax(text);
    onCostChange(costWithoutTaxText(text, taxRate) ?? text);
    setMarkup(markupText(price, text));
  };

  const changeMarkup = (text: string): void => {
    setMarkup(text);
    const worked = priceForMarkup(withTax, text);
    if (worked !== null) {
      onPriceChange?.(worked);
    }
  };

  const changePrice = (text: string): void => {
    onPriceChange?.(text);
    setMarkup(markupText(text, withTax));
  };

  const costReading = withTax.trim() === '' ? null : readUnitCost(withTax);
  const withoutReading = cost.trim() === '' ? null : readUnitCost(cost);
  const priceReading = readNewPrice(price);
  const hasCost = costReading !== null && costReading.ok && costReading.unitCostE6 > 0;
  const profitCents = hasCost && priceReading.ok ? Math.round(priceReading.unitPriceE4 / E4_PER_CENT) - Math.round(costReading.unitCostE6 / E6_PER_CENT) : null;
  const sliderValue = Math.max(0, Math.min(SLIDER_MAX, Math.round(Number(markup) || 0)));
  const canSetPrice = onPriceChange !== undefined;

  return (
    <div className="cost-margin">
      <div className="product-form-row">
        <Field
          label="Costo con IVA (opcional)"
          numeric="decimal"
          value={withTax}
          onChange={changeCost}
          maxLength={16}
          hint="Lo que te cobra el proveedor por unidad, con IVA."
          problem={costProblem}
        />
        <label className="payment-field">
          <span>Costo sin IVA</span>
          <output className="computed-value" aria-label="Costo sin IVA">
            {withoutReading !== null && withoutReading.ok ? formatUnitCost(withoutReading.unitCostE6) : '—'}
          </output>
          <small>Se calcula solo con el IVA del producto.</small>
        </label>
      </div>
      <div className="product-form-row">
        <label className="payment-field">
          <span>Ganancia sobre el costo (%)</span>
          <input
            aria-label="Ganancia sobre el costo"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            maxLength={7}
            value={markup}
            disabled={!hasCost || !canSetPrice}
            onChange={(event) => changeMarkup(keepNumeric(event.target.value, 'decimal'))}
          />
          <input
            className="margin-slider"
            aria-label="Ajustar la ganancia"
            type="range"
            min={0}
            max={SLIDER_MAX}
            step={1}
            value={sliderValue}
            disabled={!hasCost || !canSetPrice}
            tabIndex={-1}
            onChange={(event) => changeMarkup(event.target.value)}
          />
          <small>{hasCost ? (canSetPrice ? 'Muévela y el precio se calcula solo.' : 'Con el precio actual del producto.') : 'Escribe el costo para calcularla.'}</small>
        </label>
        {canSetPrice ? (
          <Field label="Precio (IVA incluido)" numeric="decimal" value={price} onChange={changePrice} maxLength={14} hint="En pesos, por ejemplo 135.50" problem={priceProblem} />
        ) : (
          <label className="payment-field">
            <span>Precio (IVA incluido)</span>
            <output className="computed-value" aria-label="Precio actual">
              {priceReading.ok ? formatCents(Math.round(priceReading.unitPriceE4 / E4_PER_CENT)) : '—'}
            </output>
            <small>Se cambia con «Cambiar precio».</small>
          </label>
        )}
      </div>
      {profitCents !== null && (
        <p className="margin-summary" data-losing={profitCents < 0} role="status">
          {profitCents < 0 ? `Pierdes ${formatCents(-profitCents)} por unidad: el precio está por debajo del costo.` : `Ganas ${formatCents(profitCents)} por unidad vendida.`}
        </p>
      )}
    </div>
  );
}
