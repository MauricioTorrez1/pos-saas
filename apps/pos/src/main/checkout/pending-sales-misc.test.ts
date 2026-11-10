import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { MISC_PRODUCT_ID } from '../../shared/miscellaneous';
import type { UserSummary } from '../../shared/auth';
import type { PendingSaleRequest } from '../../shared/pos-api';
import { AuditLog } from '../audit/audit-log';
import { AuthService } from '../auth/auth-service';
import { UserStore } from '../auth/user-store';
import { CashService } from '../cash/cash-service';
import { CashSessionStore } from '../cash/cash-session-store';
import { InventoryService } from '../inventory/inventory-service';
import { StockStore } from '../inventory/stock-store';
import { LocalStore } from '../local-store/local-store';
import { ProductCatalog } from '../local-store/product-catalog';
import { SaleStore } from '../local-store/sale-store';
import { uuidV7 } from '../uuid-v7';
import { parsePendingSaleRequest } from './pending-sale-request';
import { PendingSales } from './pending-sales';

const TENANT = 'tenant-a';
/** Two pieces at $12.50 with the VAT included. */
const TWO_FOR_TWENTY_FIVE = { miscellaneous: { name: 'Tornillo suelto', unitPriceE4: 125_000 }, quantityMilli: 2000 };

let directory: string;
let store: LocalStore;
let auth: AuthService;
let sales: SaleStore;
let stock: StockStore;
let pending: PendingSales;
let owner: UserSummary;
let cashier: UserSummary;
let hammerId: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'misc-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  auth = new AuthService(new UserStore(store, TENANT));
  const cash = new CashService(new CashSessionStore(store, TENANT), auth);
  sales = new SaleStore(store, TENANT);
  stock = new StockStore(store, TENANT);
  owner = auth.setupOwner('Mauricio', '4321');
  auth.login(owner.id, '4321');
  cashier = auth.createUser('Ana', 'cashier', '5555');
  cash.open(0);
  pending = new PendingSales(
    new ProductCatalog(store, TENANT),
    sales,
    () => ({ cashierId: auth.currentUser()!.id, cashSessionId: cash.openSessionId()! }),
    { auth, audit: new AuditLog(store, TENANT) },
  );
  hammerId = uuidV7();
  store.transaction((connection) => {
    connection
      .prepare("INSERT INTO product (id, tenant_id, name, base_unit, unit_price_e4, tax_factor, tax_rate_bp) VALUES (?, ?, 'Martillo', 'piece', 1000000, 'rate', 1600)")
      .run(hammerId, TENANT);
  });
  stock.post([{ productId: hammerId, type: 'opening_balance', quantityMilli: 10_000, source: 'import', sourceId: 'C1' }]);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function request(lines: PendingSaleRequest['lines'], expectedTotalCents: number, ownerPin?: string): PendingSaleRequest {
  return { idempotencyKey: uuidV7(), lines, expectedTotalCents, ...(ownerPin === undefined ? {} : { ownerPin }) };
}

function asCashier(): void {
  auth.logout();
  auth.login(cashier.id, '5555');
}

describe('a miscellaneous item (RF-003)', () => {
  it('is sold by the owner at the price typed, and the log says who approved it', () => {
    const result = pending.save(request([TWO_FOR_TWENTY_FIVE], 2500));

    expect(result).toMatchObject({ status: 'saved', sale: { totalCents: 2500, lines: [{ productName: 'Tornillo suelto' }] } });
    expect(store.prepare('SELECT user_id, action, entity, detail FROM audit_log').all()).toEqual([
      { user_id: owner.id, action: 'sale.misc_item', entity: 'sale', detail: expect.stringContaining(`Tornillo suelto, 2000 thousandths at 125000 ten-thousandths each; approved by ${owner.id}`) },
    ]);
  });

  it('is refused for a cashier without the PIN of the owner, and with a wrong one, and nothing is saved', () => {
    asCashier();

    expect(pending.save(request([TWO_FOR_TWENTY_FIVE], 2500))).toEqual({ status: 'authorization_required' });
    expect(pending.save(request([TWO_FOR_TWENTY_FIVE], 2500, '0000'))).toMatchObject({ status: 'wrong_pin' });

    expect(pending.list()).toEqual([]);
    expect(store.prepare('SELECT count(*) AS total FROM audit_log').get()).toEqual({ total: 0 });
  });

  it('is sold by a cashier with the PIN of the owner, and the owner is the one who approved it', () => {
    asCashier();

    const result = pending.save(request([TWO_FOR_TWENTY_FIVE], 2500, '4321'));

    expect(result.status).toBe('saved');
    expect(store.prepare('SELECT user_id, detail FROM audit_log').get()).toEqual({
      user_id: cashier.id,
      detail: expect.stringContaining(`approved by ${owner.id}`),
    });
  });

  it('moves no stock when it is sold, while the product in the same sale does, and the ledger still agrees with the sales', () => {
    const saved = pending.save(request([{ productId: hammerId, quantityMilli: 1000 }, TWO_FOR_TWENTY_FIVE], 10_000 + 2500));
    expect(saved.status).toBe('saved');
    if (saved.status !== 'saved') {
      return;
    }

    sales.markCompleted(saved.sale.id, [{ method: 'cash', amountCents: 12_500, reference: null }]);

    expect(store.prepare("SELECT product_id FROM stock_movement WHERE type = 'sale'").all()).toEqual([{ product_id: hammerId }]);
    const inventory = new InventoryService(store, TENANT, auth, stock, new AuditLog(store, TENANT), new ProductCatalog(store, TENANT));
    expect(inventory.verifyLedger().problems).toEqual([]);
  });

  it('never posts a movement under its id, even if something asks for one', () => {
    expect(stock.post([{ productId: MISC_PRODUCT_ID, type: 'adjustment', quantityMilli: 5, source: 'adjustment', sourceId: 'x' }])).toBe(0);
  });

  it('is refused when the sale is built without the support for it', () => {
    const bare = new PendingSales(new ProductCatalog(store, TENANT), sales, () => ({ cashierId: owner.id, cashSessionId: 'x' }));

    expect(() => bare.save(request([TWO_FOR_TWENTY_FIVE], 2500))).toThrow(/signed in/);
  });

  it('refuses a total that is not the one on the screen, as for any other line', () => {
    expect(pending.save(request([TWO_FOR_TWENTY_FIVE], 2499))).toEqual({ status: 'catalog_changed' });
  });
});

describe('the request of a miscellaneous item', () => {
  const base = { idempotencyKey: uuidV7(), expectedTotalCents: 2500 };

  it('keeps only what it knows, with the name trimmed', () => {
    const parsed = parsePendingSaleRequest({ ...base, lines: [{ miscellaneous: { name: '  Tornillo  ', unitPriceE4: 125_000, extra: 1 }, quantityMilli: 2000 }], ownerPin: '4321' });

    expect(parsed.lines).toEqual([{ miscellaneous: { name: 'Tornillo', unitPriceE4: 125_000 }, quantityMilli: 2000 }]);
    expect(parsed.ownerPin).toBe('4321');
  });

  it('refuses an empty or too long description, a price that is not positive, and a PIN that is not text', () => {
    const line = (name: unknown, unitPriceE4: unknown): unknown => ({ ...base, lines: [{ miscellaneous: { name, unitPriceE4 }, quantityMilli: 1000 }] });

    expect(() => parsePendingSaleRequest(line('  ', 100))).toThrow(TypeError);
    expect(() => parsePendingSaleRequest(line('x'.repeat(61), 100))).toThrow(TypeError);
    expect(() => parsePendingSaleRequest(line('Algo', 0))).toThrow(TypeError);
    expect(() => parsePendingSaleRequest(line('Algo', 1.5))).toThrow(TypeError);
    expect(() => parsePendingSaleRequest({ ...(line('Algo', 100) as object), ownerPin: 4321 })).toThrow(TypeError);
  });
});
