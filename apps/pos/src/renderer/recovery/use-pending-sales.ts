import { useCallback, useEffect, useState } from 'react';

import type { PendingSale, PosApi } from '../../shared/pos-api';

/** What the cashier says about a sale that was left pending. */
export type PendingSaleAnswer = 'confirm' | 'cancel';

/** The sales waiting for an answer. */
export interface PendingSalesReview {
  /** Oldest first. Empty when there is nothing to resolve. */
  readonly sales: readonly PendingSale[];
  /** Whether the register could not find out if any sale was left pending. */
  readonly couldNotRead: boolean;
  /** Saves an answer. The sale leaves the list only once the answer is on disk. */
  readonly answer: (saleId: string, answer: PendingSaleAnswer) => Promise<void>;
}

/**
 * Finds the sales a power cut left unresolved, when the register starts (RF-017).
 *
 * @param posApi bridge to the main process
 * @returns the sales, and how to answer each one
 */
export function usePendingSales(posApi: PosApi): PendingSalesReview {
  const [sales, setSales] = useState<readonly PendingSale[]>([]);
  const [couldNotRead, setCouldNotRead] = useState(false);

  useEffect(() => {
    posApi.listPendingSales().then(setSales, () => setCouldNotRead(true));
  }, [posApi]);

  const answer = useCallback(
    async (saleId: string, choice: PendingSaleAnswer): Promise<void> => {
      await (choice === 'confirm' ? posApi.confirmPendingSale(saleId) : posApi.cancelPendingSale(saleId));
      setSales((current) => current.filter(({ id }) => id !== saleId));
    },
    [posApi],
  );

  return { sales, couldNotRead, answer };
}
