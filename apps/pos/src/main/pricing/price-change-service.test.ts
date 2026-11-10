import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lineTotals, quantityOf, saleTotals, taxRateOf } from '@pos-saas/money';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { UserSummary } from '../../shared/auth';
import type { PendingSaleRequest } from '../../shared/pos-api';
import { MAX_UNIT_PRICE_E4 } from '../../shared/pricing';
import { AuditLog } from '../audit/audit-log';
import { AuthService } from '../auth/auth-service';
import { UserStore } from '../auth/user-store';
import { CashService } from '../cash/cash-service';
import { CashSessionStore } from '../cash/cash-session-store';
import { PendingSales } from '../checkout/pending-sales';
import type { SaleToSave } from '../checkout/sale-recorder';
import { StockStore } from '../inventory/stock-store';
import { LocalStore } from '../local-store/local-store';
import { ProductCatalog } from '../local-store/product-catalog';
import { SaleStore } from '../local-store/sale-store';
import { contractErrorsOfPushRequest } from '../sync/fakes/contract-validator';
import { registerIdOf } from '../sync/register-identity';
import { SyncOutbox } from '../sync/sync-outbox';
import { uuidV7 } from '../uuid-v7';
import { PriceChangeService } from './price-change-service';
import { parseChangePriceRequest } from './price-request';

const TENANT = 'tenant-a';
const SIXTEEN = taxRateOf('rate', 1600);
const OLD_PRICE = 1_000_000;
const NEW_PRICE = 1_350_000;

let directory: string;
let store: LocalStore;
let auth: AuthService;
let cash: CashService;
let sales: SaleStore;
let catalog: ProductCatalog;
let prices: PriceChangeService;
let pending: PendingSales;
let owner: UserSummary;
let cashier: UserSummary;
let hammerId: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'price-change-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  auth = new AuthService(new UserStore(store, TENANT));
  cash = new CashService(new CashSessionStore(store, TENANT), auth);
  sales = new SaleStore(store, TENANT);
  catalog = new ProductCatalog(store, TENANT);
  const audit = new AuditLog(store, TENANT);
  prices = new PriceChangeService(store, TENANT, auth, catalog, audit);
  pending = new PendingSales(
    catalog,
    sales,
    () => ({ cashierId: auth.currentUser()!.id, cashSessionId: cash.openSessionId()! }),
    { auth, audit },
    prices,
  );
  owner = auth.setupOwner('Mauricio', '4321');
  auth.login(owner.id, '4321');
  cashier = auth.createUser('Ana', 'cashier', '5555');
  cash.open(0);
  hammerId = uuidV7();
  store.transaction((connection) => {
    connection
      .prepare("INSERT INTO product (id, tenant_id, name, base_unit, unit_price_e4, tax_factor, tax_rate_bp) VALUES (?, ?, 'Martillo', 'piece', ?, 'rate', 1600)")
      .run(hammerId, TENANT, OLD_PRICE);
  });
  new StockStore(store, TENANT).post([
    { productId: hammerId, type: 'opening_balance', quantityMilli: 10_000, unitCostE6: 60_000_000, source: 'import', sourceId: 'C1' },
  ]);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function asCashier(): void {
  auth.logout();
  auth.login(cashier.id, '5555');
}

function request(newUnitPriceE4: number, ownerPin?: string, previousUnitPriceE4 = OLD_PRICE): Parameters<PriceChangeService['change']>[0] {
  return { productId: hammerId, previousUnitPriceE4, newUnitPriceE4, ...(ownerPin === undefined ? {} : { ownerPin }) };
}

function priceOf(): number {
  return catalog.findById(hammerId)!.unitPriceE4;
}

function auditActions(): string[] {
  return (store.prepare("SELECT action FROM audit_log WHERE action LIKE 'product.%' ORDER BY rowid").all() as unknown as { action: string }[]).map((row) => row.action);
}

/** The price operations in the outbox. Opening the cash session queued its own, which is not what these tests look at. */
function queuedTypes(): string[] {
  return (store.prepare("SELECT type FROM sync_outbox WHERE type LIKE 'product.%' ORDER BY device_seq").all() as unknown as { type: string }[]).map((row) => row.type);
}

function saleRequest(unitPriceE4?: number): PendingSaleRequest {
  const quantity = quantityOf(1000, 'piece');
  const total = saleTotals([lineTotals(unitPriceE4 ?? priceOf(), quantity, SIXTEEN)]).totalCents;
  return {
    idempotencyKey: uuidV7(),
    lines: [{ productId: hammerId, quantityMilli: 1000, ...(unitPriceE4 === undefined ? {} : { unitPriceE4 }) }],
    expectedTotalCents: total,
  };
}

describe('who may change a price (E1-39)', () => {
  it('lets the owner change it, with their name in the audit log and the new price in the catalog', () => {
    const result = prices.change(request(NEW_PRICE));

    expect(result).toMatchObject({ status: 'changed', previousUnitPriceE4: OLD_PRICE, product: { unitPriceE4: NEW_PRICE } });
    expect(priceOf()).toBe(NEW_PRICE);
    const entry = store.prepare("SELECT user_id, entity_id, detail FROM audit_log WHERE action = 'product.price_change'").get() as unknown as { user_id: string; entity_id: string; detail: string };
    expect(entry).toMatchObject({ user_id: owner.id, entity_id: hammerId });
    expect(entry.detail).toContain('Martillo: $100.00 to $135.00');
    expect(entry.detail).toContain(`approved by ${owner.id}`);
  });

  it('lets a cashier change it with the PIN of the owner, recording who asked and who approved', () => {
    asCashier();

    const result = prices.change(request(NEW_PRICE, '4321'));

    expect(result.status).toBe('changed');
    const queued = store.prepare("SELECT payload FROM sync_outbox WHERE type = 'product.price_changed'").get() as unknown as { payload: string };
    expect(JSON.parse(queued.payload)).toMatchObject({ changedBy: cashier.id, authorizedBy: owner.id });
  });

  it('refuses a cashier without a PIN, changes nothing and writes the denial', () => {
    asCashier();

    expect(prices.change(request(NEW_PRICE))).toEqual({ status: 'authorization_required' });

    expect(priceOf()).toBe(OLD_PRICE);
    expect(auditActions()).toEqual(['product.price_change_denied']);
    expect(queuedTypes()).toEqual([]);
  });

  it('refuses a wrong PIN with the tries left, and the failed attempt stays in the audit log under the cashier', () => {
    asCashier();

    expect(prices.change(request(NEW_PRICE, '0000'))).toEqual({ status: 'wrong_pin', attemptsLeft: 4 });

    expect(priceOf()).toBe(OLD_PRICE);
    const denial = store.prepare("SELECT user_id, detail FROM audit_log WHERE action = 'product.price_change_denied'").get() as unknown as { user_id: string; detail: string };
    expect(denial.user_id).toBe(cashier.id);
    expect(denial.detail).toContain('wrong_pin');
    expect(denial.detail).toContain(`${OLD_PRICE} to ${NEW_PRICE}`);
    expect(queuedTypes()).toEqual([]);
  });

  it('refuses the PIN of another cashier, because only an owner approves', () => {
    auth.createUser('Beto', 'cashier', '6666');
    asCashier();

    expect(prices.change(request(NEW_PRICE, '6666')).status).toBe('wrong_pin');

    expect(priceOf()).toBe(OLD_PRICE);
  });

  it('locks after too many wrong PINs, and the lock is also written down', () => {
    asCashier();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      prices.change(request(NEW_PRICE, '0000'));
    }

    expect(prices.change(request(NEW_PRICE, '4321')).status).toBe('locked');

    expect(priceOf()).toBe(OLD_PRICE);
    expect(auditActions().at(-1)).toBe('product.price_change_denied');
  });

  it('refuses when nobody is signed in', () => {
    auth.logout();

    expect(() => prices.change(request(NEW_PRICE))).toThrow('signed in');
  });
});

describe('what a valid price is', () => {
  it.each([
    ['zero', 0],
    ['negative', -1],
    ['with decimals', 1_000.5],
    ['not a number', Number.NaN],
    ['past the maximum', MAX_UNIT_PRICE_E4 + 1],
  ])('refuses a price that is %s, and nothing is written', (_name, bad) => {
    expect(() => prices.change(request(bad))).toThrow(RangeError);

    expect(priceOf()).toBe(OLD_PRICE);
    expect(auditActions()).toEqual([]);
    expect(queuedTypes()).toEqual([]);
  });

  it('accepts the maximum, and a price with 4 decimals such as a screw from a box', () => {
    expect(prices.change(request(MAX_UNIT_PRICE_E4)).status).toBe('changed');
    expect(prices.change(request(1530, undefined, MAX_UNIT_PRICE_E4)).status).toBe('changed');

    expect(priceOf()).toBe(1530);
  });

  it('does nothing when the price is the same one', () => {
    expect(prices.change(request(OLD_PRICE))).toEqual({ status: 'unchanged' });

    expect(auditActions()).toEqual([]);
    expect(queuedTypes()).toEqual([]);
  });

  it('refuses to overwrite a price that is no longer the one the screen showed, and says what it is now', () => {
    prices.change(request(NEW_PRICE));

    const result = prices.change(request(1_500_000));

    expect(result).toMatchObject({ status: 'stale', product: { unitPriceE4: NEW_PRICE } });
    expect(priceOf()).toBe(NEW_PRICE);
  });

  it('answers not_found for a product that does not exist', () => {
    expect(prices.change({ productId: uuidV7(), previousUnitPriceE4: 1, newUnitPriceE4: 2 })).toEqual({ status: 'not_found' });
  });

  it('checks the shape of what crosses the bridge', () => {
    expect(parseChangePriceRequest({ productId: hammerId, previousUnitPriceE4: 1, newUnitPriceE4: 2 })).toEqual({ productId: hammerId, previousUnitPriceE4: 1, newUnitPriceE4: 2 });
    expect(() => parseChangePriceRequest({ productId: 'nope', previousUnitPriceE4: 1, newUnitPriceE4: 2 })).toThrow(TypeError);
    expect(() => parseChangePriceRequest({ productId: hammerId, previousUnitPriceE4: 1, newUnitPriceE4: '2' })).toThrow(TypeError);
    expect(() => parseChangePriceRequest({ productId: hammerId, previousUnitPriceE4: 1, newUnitPriceE4: 2.5 })).toThrow(TypeError);
    expect(() => parseChangePriceRequest({ productId: hammerId, previousUnitPriceE4: 1, newUnitPriceE4: 2, ownerPin: '123456789' })).toThrow(TypeError);
  });
});

describe('the change and what travels with it (ADR 0040, ADR 0047)', () => {
  it('writes the price, the record, the audit entry and the operation together', () => {
    prices.change(request(NEW_PRICE));

    expect(auditActions()).toEqual(['product.price_change']);
    expect(queuedTypes()).toEqual(['product.price_changed']);
    expect(prices.previousPriceOf(hammerId)).toBe(OLD_PRICE);
  });

  it('keeps all of it or none of it: if queueing fails, the price and the entries are undone', () => {
    store.transaction((connection) => {
      connection.exec(`CREATE TRIGGER break_outbox BEFORE INSERT ON sync_outbox BEGIN SELECT RAISE(ABORT, 'outbox is down'); END;`);
    });

    expect(() => prices.change(request(NEW_PRICE))).toThrow();

    expect(priceOf()).toBe(OLD_PRICE);
    expect(auditActions()).toEqual([]);
    expect(prices.previousPriceOf(hammerId)).toBeNull();
  });

  it('queues an operation that follows the push contract', () => {
    prices.change(request(NEW_PRICE));
    const operations = new SyncOutbox(store, TENANT)
      .pending(100)
      .filter((operation) => operation.type === 'product.price_changed')
      .map(({ attempts: _attempts, ...operation }) => operation);

    expect(operations).toHaveLength(1);
    expect(contractErrorsOfPushRequest({ registerId: registerIdOf(store, TENANT), operations })).toEqual([]);
    expect(operations[0]).toMatchObject({
      type: 'product.price_changed',
      payload: { productId: hammerId, previousUnitPriceE4: OLD_PRICE, newUnitPriceE4: NEW_PRICE, changedBy: owner.id, authorizedBy: owner.id },
    });
  });

  it('keeps the history append-only', () => {
    prices.change(request(NEW_PRICE));

    expect(() => store.prepare('UPDATE product_price_change SET new_unit_price_e4 = 1').run()).toThrow('never changes');
    expect(() => store.prepare('DELETE FROM product_price_change').run()).toThrow('never deleted');
  });

  it('reads the last known cost for the margin, and null when the product never had one', () => {
    expect(prices.info(hammerId)).toMatchObject({ product: { id: hammerId }, lastCostE6: 60_000_000 });

    const free = uuidV7();
    store.transaction((connection) => {
      connection
        .prepare("INSERT INTO product (id, tenant_id, name, base_unit, unit_price_e4, tax_factor, tax_rate_bp) VALUES (?, ?, 'Sin costo', 'piece', 1000, 'rate', 1600)")
        .run(free, TENANT);
    });
    expect(prices.info(free)?.lastCostE6).toBeNull();
    expect(prices.info(uuidV7())).toBeNull();
  });
});

describe('sales that were already made, or are being rung up', () => {
  function completeSale(): SaleToSave {
    const quantity = quantityOf(2000, 'piece');
    const line = { id: uuidV7(), productId: hammerId, productName: 'Martillo', quantity, unitPriceE4: OLD_PRICE, totals: lineTotals(OLD_PRICE, quantity, SIXTEEN) };
    const totals = saleTotals([line.totals]);
    const sale: SaleToSave = {
      saleId: uuidV7(),
      idempotencyKey: uuidV7(),
      lines: [line],
      subtotalCents: totals.subtotalCents,
      taxCents: totals.taxCents,
      totalCents: totals.totalCents,
      cashSessionId: cash.openSessionId()!,
      cashierId: owner.id,
    };
    sales.savePendingPayment(sale);
    sales.markCompleted(sale.saleId, [{ method: 'cash', amountCents: totals.totalCents, reference: null }]);
    return sale;
  }

  it('leaves a completed sale with the price it was sold at', () => {
    const sale = completeSale();
    const before = store.prepare('SELECT unit_price_e4, total_cents FROM sale_line JOIN sale ON sale.id = sale_line.sale_id WHERE sale.id = ?').get(sale.saleId);

    prices.change(request(NEW_PRICE));

    expect(store.prepare('SELECT unit_price_e4, total_cents FROM sale_line JOIN sale ON sale.id = sale_line.sale_id WHERE sale.id = ?').get(sale.saleId)).toEqual(before);
    expect(before).toMatchObject({ unit_price_e4: OLD_PRICE, total_cents: 200_00 });
  });

  it('prices a new sale with the new price, and its total adds up', () => {
    prices.change(request(NEW_PRICE));

    const result = pending.save(saleRequest());

    expect(result).toMatchObject({ status: 'saved', sale: { totalCents: 135_00, lines: [{ unitPriceE4: NEW_PRICE, totalCents: 135_00 }] } });
  });

  it('keeps the price of a line already on the screen when the owner changed it meanwhile', () => {
    prices.change(request(NEW_PRICE));

    const result = pending.save(saleRequest(OLD_PRICE));

    expect(result).toMatchObject({ status: 'saved', sale: { totalCents: 100_00, lines: [{ unitPriceE4: OLD_PRICE }] } });
  });

  it('does not save the sale when the price the screen saw is not the one catalog has, or the one just replaced', () => {
    prices.change(request(NEW_PRICE));

    expect(pending.save(saleRequest(1_200_000))).toEqual({ status: 'catalog_changed' });
  });

  it('does not honor a price the screen invented when nothing ever changed', () => {
    expect(pending.save(saleRequest(500_000))).toEqual({ status: 'catalog_changed' });
  });

  it('asks the catalog for the price when the screen sends none', () => {
    prices.change(request(NEW_PRICE));

    expect(pending.save({ ...saleRequest(), expectedTotalCents: 100_00 })).toEqual({ status: 'catalog_changed' });
  });
});
