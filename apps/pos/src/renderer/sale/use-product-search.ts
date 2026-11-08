import { useCallback, useEffect, useRef, useState } from 'react';

import type { CatalogProduct, PosApi } from '../../shared/pos-api';

/** Longer than the longest pause inside a scan, so a scanner burst never reaches the name search. */
export const SEARCH_DELAY_MS = 80;

interface SearchState {
  /** The text these results belong to. */
  readonly text: string;
  readonly results: readonly CatalogProduct[];
  readonly highlightedIndex: number;
}

const NO_SEARCH: SearchState = { text: '', results: [], highlightedIndex: 0 };

/** What the sale screen can do with the search by name. */
export interface ProductSearch {
  readonly results: readonly CatalogProduct[];
  readonly highlightedIndex: number;
  /** Searches after a short pause. A new call replaces the one still waiting. */
  schedule(text: string): void;
  /** Searches right away and shows the results, for when the cashier pressed Enter before the pause ended. */
  searchNow(text: string): Promise<readonly CatalogProduct[]>;
  /** Moves the highlight through the results, wrapping around at the ends. */
  moveHighlight(offset: 1 | -1): void;
  /** Returns the highlighted product, or null if the results on screen are for another text. */
  highlightedFor(text: string): CatalogProduct | null;
  /** Hides the results and drops any search still on its way. */
  clear(): void;
}

/**
 * Runs the search by name. An answer that arrives after a newer search started is dropped, so the list always matches
 * what is typed.
 *
 * @param posApi bridge to the main process
 * @param onFailure called if a scheduled search fails
 * @returns the results and what can be done with them
 */
export function useProductSearch(posApi: PosApi, onFailure: () => void): ProductSearch {
  const [search, setSearch] = useState<SearchState>(NO_SEARCH);
  const latestRequest = useRef(0);
  const pendingTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(pendingTimer.current), []);

  const searchNow = useCallback(
    async (text: string): Promise<readonly CatalogProduct[]> => {
      window.clearTimeout(pendingTimer.current);
      latestRequest.current += 1;
      const request = latestRequest.current;
      const results = await posApi.searchProducts(text);
      if (request === latestRequest.current) {
        setSearch({ text, results, highlightedIndex: 0 });
      }
      return results;
    },
    [posApi],
  );

  const schedule = useCallback(
    (text: string): void => {
      window.clearTimeout(pendingTimer.current);
      pendingTimer.current = window.setTimeout(() => {
        searchNow(text).catch(onFailure);
      }, SEARCH_DELAY_MS);
    },
    [searchNow, onFailure],
  );

  const moveHighlight = useCallback((offset: 1 | -1): void => {
    setSearch((current) => {
      const { length } = current.results;
      return length === 0 ? current : { ...current, highlightedIndex: (current.highlightedIndex + offset + length) % length };
    });
  }, []);

  const clear = useCallback((): void => {
    window.clearTimeout(pendingTimer.current);
    latestRequest.current += 1;
    setSearch(NO_SEARCH);
  }, []);

  const highlightedFor = (text: string): CatalogProduct | null =>
    search.text === text ? (search.results[search.highlightedIndex] ?? null) : null;

  return {
    results: search.results,
    highlightedIndex: search.highlightedIndex,
    schedule,
    searchNow,
    moveHighlight,
    highlightedFor,
    clear,
  };
}
