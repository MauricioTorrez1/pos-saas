import { formatUnitPriceE4 } from '@pos-saas/money';
import type { ReactElement } from 'react';

import type { CatalogProduct } from '../../shared/pos-api';
import { unitLabel } from './format';

export const SEARCH_RESULTS_ID = 'sale-search-results';

/**
 * Names one option of the list, so the lookup box can point at the highlighted one.
 *
 * @param index position of the option
 * @returns the id of its element
 */
export function resultOptionId(index: number): string {
  return `${SEARCH_RESULTS_ID}-${index}`;
}

interface SearchResultsProps {
  readonly results: readonly CatalogProduct[];
  readonly highlightedIndex: number;
  readonly onChoose: (product: CatalogProduct) => void;
}

/**
 * The products that match what the cashier typed.
 *
 * @param props.results the products, best match first
 * @param props.highlightedIndex the one Enter would add
 * @param props.onChoose called when a product is clicked
 * @returns the list
 */
export function SearchResults({ results, highlightedIndex, onChoose }: SearchResultsProps): ReactElement {
  return (
    <ul id={SEARCH_RESULTS_ID} className="lookup-results" role="listbox" aria-label="Productos encontrados">
      {results.map((product, index) => (
        <li
          key={product.id}
          id={resultOptionId(index)}
          role="option"
          aria-selected={index === highlightedIndex}
          className="lookup-result"
          // On mouse down, so the lookup box never loses the keyboard.
          onMouseDown={(event) => {
            event.preventDefault();
            onChoose(product);
          }}
        >
          <span className="lookup-result-name">{product.name}</span>
          <span className="lookup-result-price">
            {formatUnitPriceE4(product.unitPriceE4)} / {unitLabel(product.unit)}
          </span>
        </li>
      ))}
    </ul>
  );
}
