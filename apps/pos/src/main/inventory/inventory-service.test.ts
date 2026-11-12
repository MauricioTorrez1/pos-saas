import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lineTotals, quantityOf, saleTotals, taxRateOf } from '@pos-saas/money';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { UserSummary } from '../../shared/auth';
import { AuditLog } from '../audit/audit-log';
import { AuthService } from '../auth/auth-service';
import { UserStore } from '../auth/user-store';
import { CashService } from '../cash/cash-service';
import { CashSessionStore } from '../cash/cash-session-store';
import type { SaleToSave } from '../checkout/sale-recorder';
import { LocalStore } from '../local-store/local-store';
import { ProductCatalog } from '../local-store/product-catalog';
import { SaleStore } from '../local-store/sale-store';
import { uuidV7 } from '../uuid-v7';
import { InventoryService } from './inventory-service';
import { StockStore } from './stock-store';

const TENANT = 'tenant-a';

let directory: string;
let store: LocalStore;
let inventory: InventoryService;
let stock: StockStore;
let sales: SaleStore;
let cash: CashService;
let auth: AuthService;
let owner: UserSummary;
let productId: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'inventory-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  auth = new AuthService(new UserStore(store, TENANT));
  stock =new StockStore(store, TENANT);
  inventory = new InventoryService(store, TENANT, auth, stock, new AuditLog(store, TENANT), new ProductCatalog(store, TENANT));
  sales = new SaleStore(store, TENANT);
  cash = new CashService(new CashSessionStore(store, TENANT), auth);
  owner = auth.setupOwner('Mauricio', '4321');
  auth.login(owner.id, '4321');
  cash.open(0);
  productId = uuidV7();
  store.transaction((connection) => {
    connection
      .prepare("INSERT INTO product (id, tenant_id, name, base_unit, unit_price_e4, tax_factor, tax_rate_bp) VALUES (?, ?, 'Cable THW', 'meter', 125000, 'rate', 1600)")
      .run(productId, TENANT);
  });
  stock.post([{ productId, type: 'opening_balance', quantityMilli: 100_000, source: 'import', sourceId: 'C1' }]);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function sellCable(milli: number): SaleToSave {
  const quantity = quantityOf(milli, 'meter');
  const line = { id: uuidV7(), productId, productName: 'Cable THW', quantity, unitPriceE4: 125_000, totals: lineTotals(125_000, quantity, taxRateOf('rate', 1600)) };
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

describe('adjusting the stock (RF-030)', () => {
  it('records a loss as a movement with its reason in the audit log, and the stock goes down', () => {
    const result = inventory.adjust({ productId, type: 'waste', quantityMilli: -5000, reason: 'Rollo dañado por humedad' });

    expect(result).toMatchObject({ status: 'recorded', kardex: { stockMilli: 95_000 } });
    expect(store.prepare('SELECT action, entity, user_id, detail FROM audit_log').get()).toEqual({
      action: 'stock.waste',
      entity: 'product',
      user_id: owner.id,
      detail: expect.stringContaining('Rollo dañado por humedad'),
    });
  });

  it('records a count that corrected the shelf, in either direction', () => {
    inventory.adjust({ productId, type: 'adjustment', quantityMilli: 2500, reason: 'Conteo del lunes' });
    inventory.adjust({ productId, type: 'adjustment', quantityMilli: -500, reason: 'Conteo del martes' });

    expect(stock.levelOf(productId)).toBe(102_000);
  });

  it('refuses a loss that adds stock, a movement of zero, and a reason that is empty', () => {
    expect(inventory.adjust({ productId, type: 'waste', quantityMilli: 1000, reason: 'x' })).toEqual({ status: 'waste_must_be_negative' });
    expect(() => inventory.adjust({ productId, type: 'adjustment', quantityMilli: 0, reason: 'x' })).toThrow(RangeError);
    expect(() => inventory.adjust({ productId, type: 'adjustment', quantityMilli: 1000, reason: '  ' })).toThrow(/reason/);
    expect(stock.levelOf(productId)).toBe(100_000);
  });

  it('says so when the product does not exist', () => {
    expect(inventory.adjust({ productId: uuidV7(), type: 'adjustment', quantityMilli: 1000, reason: 'x' })).toEqual({ status: 'not_found' });
  });

  it('needs the owner: a cashier without the PIN of an owner changes nothing and the denial is written down', () => {
    const cashier = auth.createUser('Ana', 'cashier', '5555');
    auth.logout();
    auth.login(cashier.id, '5555');

    expect(inventory.adjust({ productId, type: 'waste', quantityMilli: -1, reason: 'x' })).toEqual({ status: 'authorization_required' });

    expect(stock.levelOf(productId)).toBe(100_000);
    expect(store.prepare("SELECT action FROM audit_log WHERE action LIKE 'stock.%'").all()).toEqual([{ action: 'stock.adjust_denied' }]);
  });

  it('lets a cashier adjust with the PIN of an owner, and writes who approved', () => {
    const cashier = auth.createUser('Ana', 'cashier', '5555');
    auth.logout();
    auth.login(cashier.id, '5555');

    const result = inventory.adjust({ productId, type: 'waste', quantityMilli: -1000, reason: 'Broken', ownerPin: '4321' });

    expect(result.status).toBe('recorded');
    expect(stock.levelOf(productId)).toBe(99_000);
    const entry = store.prepare("SELECT user_id, detail FROM audit_log WHERE action = 'stock.waste'").get() as unknown as { user_id: string; detail: string };
    expect(entry).toMatchObject({ user_id: cashier.id });
    expect(entry.detail).toContain(`approved by ${owner.id}`);
  });

  it('refuses a wrong PIN with the tries left', () => {
    const cashier = auth.createUser('Ana', 'cashier', '5555');
    auth.logout();
    auth.login(cashier.id, '5555');

    expect(inventory.adjust({ productId, type: 'waste', quantityMilli: -1000, reason: 'Broken', ownerPin: '0000' })).toEqual({ status: 'wrong_pin', attemptsLeft: 4 });
    expect(stock.levelOf(productId)).toBe(100_000);
  });

  it('does not touch the stock when the audit entry cannot be written, so a change never lacks its entry', () => {
    store.transaction((connection) => {
      connection.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
    });

    expect(() => inventory.adjust({ productId, type: 'waste', quantityMilli: -1000, reason: 'x' })).toThrow('disk full');

    expect(stock.levelOf(productId)).toBe(100_000);
  });
});

describe('the kardex (RF-031)', () => {
  it('shows the movements with a running balance that ends at the stock', () => {
    sellCable(3275);
    inventory.adjust({ productId, type: 'waste', quantityMilli: -1000, reason: 'Corte mal hecho' });

    const kardex = inventory.kardex(productId);

    expect(kardex).toMatchObject({ productName: 'Cable THW', unit: 'meter', stockMilli: 95_725, totalMovements: 3 });
    expect(kardex!.rows.map((row) => [row.type, row.quantityMilli, row.balanceMilli])).toEqual([
      ['waste', -1000, 95_725],
      ['sale', -3275, 96_725],
      ['opening_balance', 100_000, 100_000],
    ]);
    expect(kardex!.rows[0]!.balanceMilli).toBe(kardex!.stockMilli);
  });

  it('keeps the balance right even when only the newest rows are shown', () => {
    for (let index = 0; index < 60; index += 1) {
      stock.post([{ productId, type: 'adjustment', quantityMilli: 1, source: 'adjustment', sourceId: `a${index}` }]);
    }

    const kardex = inventory.kardex(productId)!;

    expect(kardex.rows).toHaveLength(50);
    expect(kardex.totalMovements).toBe(61);
    expect(kardex.rows[0]!.balanceMilli).toBe(kardex.stockMilli);
    expect(kardex.rows[49]!.balanceMilli).toBe(100_000 + 11);
  });

  it('is empty for a product that does not exist', () => {
    expect(inventory.kardex(uuidV7())).toBeNull();
  });
});

describe('checking the ledger against the sales', () => {
  it('finds nothing wrong in a healthy register', () => {
    sellCable(3275);

    expect(inventory.verifyLedger()).toEqual({ checkedMovements: 2, problems: [] });
  });

  it('finds a sale line whose movement is missing, and a movement that no sale explains', () => {
    const sale = sellCable(3275);
    // A ledger cannot be edited from the register, so the test breaks it the way a damaged file would.
    store.transaction((connection) => {
      connection.exec('DROP TRIGGER stock_movement_is_never_deleted');
      connection.exec("DELETE FROM stock_movement WHERE type = 'sale'");
      connection.exec("INSERT INTO stock_movement (id, tenant_id, product_id, type, quantity_milli, source, source_id, occurred_at) VALUES ('orphan', 'tenant-a', '" + productId + "', 'sale', -1, 'sale_line', 'no-such-line', '2026-11-08T00:00:00.000Z')");
    });

    const check = inventory.verifyLedger();

    expect(check.problems).toEqual(
      expect.arrayContaining([
        { kind: 'sale_without_movement', sourceId: sale.lines[0]!.id },
        { kind: 'movement_without_source', sourceId: 'no-such-line' },
      ]),
    );
  });

  it('finds a movement whose quantity is not the one that was sold', () => {
    const sale = sellCable(3275);
    store.transaction((connection) => {
      connection.exec('DROP TRIGGER stock_movement_never_changes');
      connection.exec("UPDATE stock_movement SET quantity_milli = -9999 WHERE type = 'sale'");
    });

    expect(inventory.verifyLedger().problems).toEqual([{ kind: 'wrong_quantity', sourceId: sale.lines[0]!.id }]);
  });
});
