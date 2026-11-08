import { formatCents, type SaleTotals, type TaxGroup } from '@pos-saas/money';
import type { ReactElement } from 'react';

import { formatTaxLabel } from './format';

function taxGroupAmount({ taxRate, taxCents }: TaxGroup): string {
  return taxRate.factor === 'exempt' ? 'Sin IVA' : formatCents(taxCents);
}

interface SaleSummaryProps {
  readonly lineCount: number;
  readonly totals: SaleTotals;
}

/**
 * What the customer owes, drawn as the price tag of the sale so it reads from across the counter.
 *
 * @param props.lineCount how many different products the sale has
 * @param props.totals the totals of the sale
 * @returns the summary
 */
export function SaleSummary({ lineCount, totals }: SaleSummaryProps): ReactElement {
  return (
    <aside className="sale-summary" aria-label="Resumen de la venta">
      <div className="price-tag">
        <span className="price-tag-label">Total</span>
        <output className="price-tag-amount" aria-label="Total">
          {formatCents(totals.totalCents)}
        </output>
      </div>
      <dl className="summary-rows">
        <div>
          <dt>Productos</dt>
          <dd>{lineCount}</dd>
        </div>
        <div>
          <dt>Base sin IVA</dt>
          <dd>{formatCents(totals.subtotalCents)}</dd>
        </div>
        {totals.taxGroups.map((group) => (
          <div key={`${group.taxRate.factor}:${group.taxRate.rateBp}`}>
            <dt>{formatTaxLabel(group.taxRate)}</dt>
            <dd>{taxGroupAmount(group)}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
