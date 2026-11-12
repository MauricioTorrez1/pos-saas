import type { AdjustmentType } from '../../shared/inventory-api';

/** What a person can say happened to the stock, in the words of the shop. */
export type StockKind = 'waste' | 'surplus' | 'shortage';

/** Each kind with its label, the type of movement it writes in the ledger, and the sign of its quantity. */
export const STOCK_KINDS: Readonly<Record<StockKind, { readonly label: string; readonly type: AdjustmentType; readonly sign: 1 | -1 }>> = {
  waste: { label: 'Merma (se perdió o se dañó)', type: 'waste', sign: -1 },
  surplus: { label: 'Sobrante (hay más de lo que dice la caja)', type: 'adjustment', sign: 1 },
  shortage: { label: 'Faltante (hay menos de lo que dice la caja)', type: 'adjustment', sign: -1 },
};

/** How each type of movement of the ledger reads in a list. */
export const MOVEMENT_LABELS: Readonly<Record<string, string>> = {
  opening_balance: 'Existencia inicial',
  sale: 'Venta',
  return: 'Devolución',
  adjustment: 'Ajuste',
  waste: 'Merma',
};
