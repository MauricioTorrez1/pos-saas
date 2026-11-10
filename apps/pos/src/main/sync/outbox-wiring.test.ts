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
import type { SalePayment, SaleToSave } from '../checkout/sale-recorder';
import { InventoryService } from '../inventory/inventory-service';
import { StockStore } from '../inventory/stock-store';
import { LocalStore } from '../local-store/local-store';
import { ProductCatalog } from '../local-store/product-catalog';
import { SaleStore } from '../local-store/sale-store';
import { ReturnService } from '../returns/return-service';
import { ReturnStore } from '../returns/return-store';
import { uuidV7 } from '../uuid-v7';
import { contractErrorsOfPushRequest } from './fakes/contract-validator';
import { FakeSyncTransport } from './fakes/fake-sync-transport';
import { OutboxSynchronizer } from './outbox-synchronizer';
import { registerIdOf } from './register-identity';
import { SyncOutbox } from './sync-outbox';

const TENANT = 'tenant-a';
const SIXTEEN = taxRateOf('rate', 1600);

let directory: string;
let store: LocalStore;
let auth: AuthService;
let cash: CashService;
let sales: SaleStore;
let returns: ReturnService;
let inventory: InventoryService;
let owner: UserSummary;
let productId: string;

interface QueuedRow {
  device_seq: number;
  type: string;
  payload: string;
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'outbox-wiring-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  auth = new AuthService(new UserStore(store, TENANT));
  cash = new CashService(new CashSessionStore(store, TENANT), auth);
  sales = new SaleStore(store, TENANT);
  returns = new ReturnService(new ReturnStore(store, TENANT), auth, cash);
  inventory = new InventoryService(store, TENANT, auth, new StockStore(store, TENANT), new AuditLog(store, TENANT), new ProductCatalog(store, TENANT));
  owner = auth.setupOwner('Mauricio', '4321');
  auth.login(owner.id, '4321');
  productId = uuidV7();
  store.transaction((connection) => {
    connection
      .prepare("INSERT INTO product (id, tenant_id, name, base_unit, unit_price_e4, tax_factor, tax_rate_bp) VALUES (?, ?, 'Cable THW', 'meter', 125000, 'rate', 1600)")
      .run(productId, TENANT);
  });
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function queued(): QueuedRow[] {
  return store.prepare('SELECT device_seq, type, payload FROM sync_outbox ORDER BY device_seq').all() as unknown as QueuedRow[];
}

function typesQueued(): string[] {
  return queued().map((row) => row.type);
}

function sellCable(payments: (total: number) => SalePayment[]): SaleToSave {
  const quantity = quantityOf(3275, 'meter');
  const line = { id: uuidV7(), productId, productName: 'Cable THW', quantity, unitPriceE4: 125_000, totals: lineTotals(125_000, quantity, SIXTEEN) };
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
  sales.markCompleted(sale.saleId, payments(totals.totalCents));
  return sale;
}

const CASH_ONLY = (total: number): SalePayment[] => [{ method: 'cash', amountCents: total, reference: null }];
const MIXED = (total: number): SalePayment[] => [
  { method: 'cash', amountCents: total - 4000, reference: null },
  { method: 'transfer', amountCents: 4000, reference: 'SPEI-8841' },
];

describe('what writes to the outbox', () => {
  it('queues a completed sale, and only when it completes: a pending or cancelled sale is not news for the core', () => {
    cash.open(0);
    const quantity = quantityOf(1000, 'piece');
    const line = { id: uuidV7(), productId, productName: 'Martillo', quantity, unitPriceE4: 1_160_000, totals: lineTotals(1_160_000, quantity, SIXTEEN) };
    const totals = saleTotals([line.totals]);
    const base = { lines: [line], subtotalCents: totals.subtotalCents, taxCents: totals.taxCents, totalCents: totals.totalCents };
    const cancelled: SaleToSave = { ...base, saleId: uuidV7(), idempotencyKey: uuidV7() };
    sales.savePendingPayment(cancelled);
    sales.cancel(cancelled.saleId);
    sales.savePendingPayment({ ...base, lines: [{ ...line, id: uuidV7() }], saleId: uuidV7(), idempotencyKey: uuidV7() });
    expect(typesQueued()).toEqual(['cash_session.opened']);

    const sale = sellCable(CASH_ONLY);

    expect(typesQueued()).toEqual(['cash_session.opened', 'sale.completed']);
    expect(JSON.parse(queued()[1]!.payload)).toMatchObject({ saleId: sale.saleId, folio: 1, totalCents: sale.totalCents, payments: [{ method: 'cash' }] });
  });

  it('writes the operation in the same transaction as the sale, so a failure leaves neither', () => {
    cash.open(0);
    const before = queued().length;
    const outbox = new SyncOutbox(store, TENANT);

    expect(() =>
      store.transaction(() => {
        outbox.enqueue('cash_movement.recorded', {});
        throw new Error('The register died');
      }),
    ).toThrow('The register died');

    expect(queued()).toHaveLength(before);
  });

  it('refuses to queue an operation outside a transaction, which would break that promise', () => {
    expect(() => new SyncOutbox(store, TENANT).enqueue('cash_movement.recorded', {})).toThrow('inside the transaction');
  });

  it('does not queue the sale when completing it fails', () => {
    cash.open(0);
    const sale = sellCable(CASH_ONLY);
    const before = queued().length;

    expect(() => sales.markCompleted(sale.saleId, CASH_ONLY(sale.totalCents))).toThrow();

    expect(queued()).toHaveLength(before);
  });

  it('queues a return, a cash movement, a stock write-off and the cut, each in order', () => {
    cash.open(50000);
    const sale = sellCable(MIXED);
    const saleLineId = sale.lines[0]!.id;
    cash.recordMovement({ kind: 'out', amountCents: 1000, reason: 'Pago de flete' });
    returns.create({ saleId: sale.saleId, lines: [{ saleLineId, quantityMilli: 1000 }], reason: 'Era otra medida', override: true });
    inventory.adjust({ productId, type: 'waste', quantityMilli: -1500, reason: 'Cable cortado mal' });
    cash.close({ counts: { 50000: 1 }, cardCountedCents: 0, transferCountedCents: 4000 - 1000, reason: 'Prueba' });

    expect(typesQueued()).toEqual([
      'cash_session.opened',
      'sale.completed',
      'cash_movement.recorded',
      'return.registered',
      'stock.adjusted',
      'cash_session.closed',
    ]);
    const seqs = queued().map((row) => row.device_seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it('never queues the movements a sale or a return makes in the stock: the core makes those itself', () => {
    cash.open(0);
    sellCable(CASH_ONLY);

    expect(typesQueued()).not.toContain('stock.adjusted');
    expect(store.prepare('SELECT count(*) AS total FROM stock_movement').get()).toEqual({ total: 1 });
  });
});

describe('what the register really sends follows the contract of packages/contracts', () => {
  it('sends a whole day of operations that the contract accepts', async () => {
    cash.open(50000);
    const sale = sellCable(MIXED);
    cash.recordMovement({ kind: 'in', amountCents: 500, reason: 'Cambio' });
    returns.create({ saleId: sale.saleId, lines: [{ saleLineId: sale.lines[0]!.id, quantityMilli: 1000 }], reason: 'Era otra medida', override: true });
    inventory.adjust({ productId, type: 'adjustment', quantityMilli: 2000, reason: 'Conteo del jueves' });
    sellCable(CASH_ONLY);
    cash.close({ counts: {}, cardCountedCents: 0, transferCountedCents: 0, reason: 'Se contó mal' });
    const core = new FakeSyncTransport();

    const outcome = await new OutboxSynchronizer({
      outbox: new SyncOutbox(store, TENANT),
      transport: core,
      registerId: registerIdOf(store, TENANT),
    }).pushPending();

    expect(outcome).toMatchObject({ accepted: 7, remaining: 0, failure: null });
    expect(core.requests).toHaveLength(1);
    expect(contractErrorsOfPushRequest(core.requests[0])).toEqual([]);
  });

  it('writes the amounts of a sale in cents and the quantities in thousandths, as integers', () => {
    cash.open(0);
    sellCable(MIXED);

    const payload = JSON.parse(queued()[1]!.payload) as { totalCents: number; lines: { quantityMilli: number; unitPriceE4: number }[]; payments: { amountCents: number }[] };

    expect(payload.lines[0]).toMatchObject({ quantityMilli: 3275, unitPriceE4: 125_000 });
    expect(payload.payments.reduce((sum, payment) => sum + payment.amountCents, 0)).toBe(payload.totalCents);
    expect(Number.isInteger(payload.totalCents)).toBe(true);
  });
});

describe('the register id', () => {
  it('is made once and stays the same, even after the database is reopened', () => {
    const first = registerIdOf(store, TENANT);
    store.close();
    store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });

    expect(registerIdOf(store, TENANT)).toBe(first);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('the outbox table', () => {
  function queueOne(): string {
    return store.transaction(() => new SyncOutbox(store, TENANT).enqueue('cash_movement.recorded', { number: 1 }));
  }

  it('never changes what an operation says once it is queued', () => {
    const opId = queueOne();

    expect(() => store.prepare("UPDATE sync_outbox SET payload = '{}' WHERE op_id = ?").run(opId)).toThrow('never changes after it is queued');
    expect(() => store.prepare('UPDATE sync_outbox SET device_seq = 99 WHERE op_id = ?').run(opId)).toThrow('never changes after it is queued');
  });

  it('never deletes an operation, delivered or not', () => {
    queueOne();

    expect(() => store.prepare('DELETE FROM sync_outbox').run()).toThrow('never deleted');
  });

  it('never goes back from delivered to pending', () => {
    const opId = queueOne();
    new SyncOutbox(store, TENANT).markDelivered([{ opId, status: 'accepted' }]);

    expect(() => store.prepare("UPDATE sync_outbox SET status = 'pending', server_status = NULL WHERE op_id = ?").run(opId)).toThrow('never changes');
  });

  it('refuses a delivered operation without the answer of the core, and the other way around', () => {
    const opId = queueOne();

    expect(() => store.prepare("UPDATE sync_outbox SET status = 'delivered' WHERE op_id = ?").run(opId)).toThrow();
    expect(() => store.prepare("UPDATE sync_outbox SET server_status = 'accepted' WHERE op_id = ?").run(opId)).toThrow();
  });

  it('refuses a payload that is not JSON', () => {
    expect(() =>
      store.prepare("INSERT INTO sync_outbox (op_id, tenant_id, type, schema_version, occurred_at, payload) VALUES ('x', ?, 'sale.completed', 1, 'now', 'not json')").run(TENANT),
    ).toThrow();
  });

  it('numbers each operation after the previous one', () => {
    queueOne();
    queueOne();

    expect(store.prepare('SELECT max(device_seq) AS device_seq FROM sync_outbox').get()).toEqual({ device_seq: 2 });
    queueOne();
    expect(store.prepare('SELECT max(device_seq) AS device_seq FROM sync_outbox').get()).toEqual({ device_seq: 3 });
  });

  it('keeps the operations of one business apart from another', () => {
    queueOne();
    const other = new SyncOutbox(store, 'tenant-b');

    expect(other.pending(10)).toEqual([]);
    expect(new SyncOutbox(store, TENANT).pending(10)).toHaveLength(1);
  });
});
