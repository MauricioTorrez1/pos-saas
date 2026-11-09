import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalStore } from '../local-store/local-store';
import { uuidV7 } from '../uuid-v7';
import { StockStore } from './stock-store';

const TENANT = 'tenant-a';

let directory: string;
let store: LocalStore;
let stock: StockStore;
const PRODUCT = uuidV7();

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'stock-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  stock = new StockStore(store, TENANT);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

const opening = (quantityMilli: number, sourceId = 'A1'): Parameters<StockStore['post']>[0][number] => ({
  productId: PRODUCT,
  type: 'opening_balance',
  quantityMilli,
  source: 'import',
  sourceId,
});

describe('the stock of a product', () => {
  it('is zero for a product with no movements', () => {
    expect(stock.levelOf(PRODUCT)).toBe(0);
  });

  it('is the sum of its movements: 100.000 m of rollo less 3.275 m of cable sold is 96.725 m', () => {
    stock.post([opening(100_000)]);
    stock.post([{ productId: PRODUCT, type: 'sale', quantityMilli: -3275, source: 'sale_line', sourceId: 'line-1' }]);

    expect(stock.levelOf(PRODUCT)).toBe(96_725);
  });

  it('goes up with a return and can go below zero, because the sale already happened', () => {
    stock.post([{ productId: PRODUCT, type: 'sale', quantityMilli: -2000, source: 'sale_line', sourceId: 'line-1' }]);
    expect(stock.levelOf(PRODUCT)).toBe(-2000);

    stock.post([{ productId: PRODUCT, type: 'return', quantityMilli: 1000, source: 'return_line', sourceId: 'return-1' }]);

    expect(stock.levelOf(PRODUCT)).toBe(-1000);
  });

  it('ignores a movement that its source already posted, so nothing is counted twice (RF-034)', () => {
    expect(stock.post([opening(5000)])).toBe(1);
    expect(stock.post([opening(5000)])).toBe(0);
    expect(stock.post([opening(9999)])).toBe(0);

    expect(stock.levelOf(PRODUCT)).toBe(5000);
  });

  it('keeps the stock of each business on its own', () => {
    stock.post([opening(5000)]);

    expect(new StockStore(store, 'tenant-b').levelOf(PRODUCT)).toBe(0);
  });
});

describe('the database refuses what the rules forbid', () => {
  const run = (sql: string): void => {
    store.transaction((connection) => {
      connection.exec(sql);
    });
  };

  it('never changes or deletes a movement', () => {
    stock.post([opening(5000)]);

    expect(() => run('UPDATE stock_movement SET quantity_milli = 1')).toThrow('never changes');
    expect(() => run('DELETE FROM stock_movement')).toThrow('never deleted');
  });

  it('refuses a movement of zero and a type it does not know', () => {
    expect(() => stock.post([opening(0)])).toThrow(/CHECK/);
    expect(() => stock.post([{ ...opening(1), type: 'gift' as never }])).toThrow('unknown stock movement type');
  });
});
