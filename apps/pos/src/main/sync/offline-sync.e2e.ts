import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { lineTotals, quantityOf, saleTotals, taxRateOf } from '@pos-saas/money';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuthService } from '../auth/auth-service';
import { UserStore } from '../auth/user-store';
import { CashService } from '../cash/cash-service';
import { CashSessionStore } from '../cash/cash-session-store';
import { LocalStore } from '../local-store/local-store';
import { SaleStore } from '../local-store/sale-store';
import { uuidV7 } from '../uuid-v7';
import { FlakyNetworkProxy } from './fakes/flaky-network-proxy';
import { HttpSyncTransport } from './http-sync-transport';
import { OutboxSynchronizer } from './outbox-synchronizer';
import { MAX_BATCH_SIZE, type SyncOperation } from './sync-protocol';
import { SyncOutbox } from './sync-outbox';

/**
 * E1-20: the register sells 1,000 times with no network, the network comes back, and the real synchronizer pushes
 * everything through a proxy that cuts the line twice to a real core. `OfflineSyncEndToEndTest` in `services/core`
 * starts that core with PostgreSQL, enrolls the register, runs this file and then compares the database with the
 * summary written here (ADR 0066). It is not part of `pnpm test` because it needs that core.
 */

const SALES = 1_000;
const SIXTEEN = taxRateOf('rate', 1600);
const PRODUCTS = [
  { name: 'Cable THW calibre 12', unit: 'meter', unitPriceE4: 125_000 },
  { name: 'Tornillo para madera 1"', unit: 'piece', unitPriceE4: 8_620 },
  { name: 'Pintura vinílica blanca', unit: 'liter', unitPriceE4: 1_034_483 },
] as const;

/** What the Java side passes in. */
interface CoreUnderTest {
  readonly coreUrl: string;
  readonly deviceToken: string;
  readonly tenantId: string;
  readonly registerId: string;
  readonly summaryPath: string;
}

/** What the Java side compares against PostgreSQL. */
interface RegisterSummary {
  readonly sales: number;
  readonly totalCents: number;
  readonly operations: number;
  readonly saleIds: readonly string[];
}

function coreUnderTest(): CoreUnderTest {
  const read = (name: string): string => {
    const value = process.env[name];
    if (value === undefined || value === '') {
      throw new Error(`${name} is missing: run this file through OfflineSyncEndToEndTest (see apps/pos/README.md)`);
    }
    return value;
  };
  return {
    coreUrl: read('E2E_CORE_URL'),
    deviceToken: read('E2E_DEVICE_TOKEN'),
    tenantId: read('E2E_TENANT_ID'),
    registerId: read('E2E_REGISTER_ID'),
    summaryPath: read('E2E_SUMMARY_PATH'),
  };
}

const core = coreUnderTest();
let directory: string;
let store: LocalStore;
let sales: SaleStore;
let cash: CashService;
let outbox: SyncOutbox;
let proxy: FlakyNetworkProxy;
let transport: HttpSyncTransport;
let synchronizer: OutboxSynchronizer;
let cashierId: string;
const productIds: string[] = [];

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'offline-sync-e2e-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  const auth = new AuthService(new UserStore(store, core.tenantId));
  cash = new CashService(new CashSessionStore(store, core.tenantId), auth);
  sales = new SaleStore(store, core.tenantId);
  outbox = new SyncOutbox(store, core.tenantId);
  cashierId = auth.setupOwner('Mauricio', '4321').id;
  auth.login(cashierId, '4321');
  store.transaction((connection) => {
    const insert = connection.prepare(
      "INSERT INTO product (id, tenant_id, name, base_unit, unit_price_e4, tax_factor, tax_rate_bp) VALUES (?, ?, ?, ?, ?, 'rate', 1600)",
    );
    for (const product of PRODUCTS) {
      const id = uuidV7();
      insert.run(id, core.tenantId, product.name, product.unit, product.unitPriceE4);
      productIds.push(id);
    }
  });
  proxy = await FlakyNetworkProxy.start(core.coreUrl);
  transport = new HttpSyncTransport({ baseUrl: proxy.url, deviceToken: core.deviceToken, timeoutMs: 30_000 });
  synchronizer = new OutboxSynchronizer({ outbox, transport, registerId: core.registerId });
});

afterAll(async () => {
  await proxy?.close();
  store?.close();
  rmSync(directory, { recursive: true, force: true });
});

/** Rings up and charges in cash one sale of one to three lines, with quantities that change from sale to sale. */
function sellInCash(index: number): { saleId: string; totalCents: number } {
  const lineCount = 1 + (index % 3);
  const lines = Array.from({ length: lineCount }, (_, offset) => {
    const product = PRODUCTS[(index + offset) % PRODUCTS.length]!;
    const quantity = quantityOf(product.unit === 'piece' ? 1000 * (1 + ((index + offset) % 12)) : 250 * (1 + ((index * 7 + offset) % 40)), product.unit);
    return {
      id: uuidV7(),
      productId: productIds[(index + offset) % PRODUCTS.length]!,
      productName: product.name,
      quantity,
      unitPriceE4: product.unitPriceE4,
      totals: lineTotals(product.unitPriceE4, quantity, SIXTEEN),
    };
  });
  const totals = saleTotals(lines.map((line) => line.totals));
  const saleId = uuidV7();
  sales.savePendingPayment({
    saleId,
    idempotencyKey: uuidV7(),
    lines,
    subtotalCents: totals.subtotalCents,
    taxCents: totals.taxCents,
    totalCents: totals.totalCents,
    cashSessionId: cash.openSessionId()!,
    cashierId,
  });
  sales.markCompleted(saleId, [{ method: 'cash', amountCents: totals.totalCents, reference: null }]);
  return { saleId, totalCents: totals.totalCents };
}

/** Every operation in the outbox, delivered or not, in the order the register made them. */
function everyOperation(): SyncOperation[] {
  const rows = store.prepare('SELECT op_id, device_seq, type, schema_version, occurred_at, payload FROM sync_outbox ORDER BY device_seq').all() as unknown as {
    op_id: string;
    device_seq: number;
    type: SyncOperation['type'];
    schema_version: number;
    occurred_at: string;
    payload: string;
  }[];
  return rows.map((row) => ({
    opId: row.op_id,
    deviceSeq: row.device_seq,
    type: row.type,
    schemaVersion: row.schema_version,
    occurredAt: row.occurred_at,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
  }));
}

function localSales(): { count: number; totalCents: number } {
  return store
    .prepare("SELECT count(*) AS count, coalesce(sum(total_cents), 0) AS totalCents FROM sale WHERE tenant_id = ? AND status = 'completed'")
    .get(core.tenantId) as unknown as { count: number; totalCents: number };
}

describe('1,000 sales without internet reach a real core once each (E1-20)', () => {
  const rungUp: { saleId: string; totalCents: number }[] = [];
  const operationCount = SALES + 1; // the sales plus the opening of the cash session

  it('sells in cash with no network and keeps every sale in the outbox', async () => {
    cash.open(0);
    for (let index = 0; index < SALES; index += 1) {
      rungUp.push(sellInCash(index));
    }

    const offline = await synchronizer.pushPending();

    expect(offline.failure?.message).toBe('The core could not be reached');
    expect(offline.accepted).toBe(0);
    expect(offline.remaining).toBe(operationCount);
    expect(localSales()).toEqual({ count: SALES, totalCents: rungUp.reduce((sum, sale) => sum + sale.totalCents, 0) });
    expect(outbox.counts()).toEqual({ pending: operationCount, delivered: 0, quarantined: 0 });
  });

  it('loses the line halfway through a request: the core stores nothing and nothing is marked delivered', async () => {
    proxy.goOnline();
    proxy.cutPush(1, 'request-halfway');

    const cut = await synchronizer.pushPending();

    expect(cut.failure).not.toBeNull();
    expect(cut.accepted).toBe(0);
    expect(cut.remaining).toBe(operationCount);
  });

  it('loses the answer of a batch the core stored: the register keeps it pending and does not lose it', async () => {
    proxy.cutPush(3, 'response-lost');

    const cut = await synchronizer.pushPending();

    expect(cut.failure).not.toBeNull();
    expect(cut.accepted).toBe(MAX_BATCH_SIZE);
    expect(cut.remaining).toBe(operationCount - MAX_BATCH_SIZE);
  });

  it('retries: the batch the core already had comes back as duplicate and the rest is accepted', async () => {
    const retry = await synchronizer.pushPending();

    expect(retry.failure).toBeNull();
    expect(retry.duplicates).toBe(MAX_BATCH_SIZE);
    expect(retry.accepted).toBe(operationCount - 2 * MAX_BATCH_SIZE);
    expect(retry.quarantined).toBe(0);
    expect(retry.remaining).toBe(0);
    expect(outbox.counts()).toEqual({ pending: 0, delivered: operationCount, quarantined: 0 });
    expect(proxy.pushesWhileOnline).toBe(1 + 2 + Math.ceil(operationCount / MAX_BATCH_SIZE) - 1);
  });

  it('replays batches that were already delivered: every operation is a duplicate', async () => {
    const operations = everyOperation();
    for (const batch of [operations.slice(0, MAX_BATCH_SIZE), operations.slice(-MAX_BATCH_SIZE)]) {
      const replay = await transport.push({ registerId: core.registerId, operations: batch });

      expect(replay.results.map(({ status }) => status)).toEqual(batch.map(() => 'duplicate'));
      expect(replay.results.map(({ opId }) => opId)).toEqual(batch.map(({ opId }) => opId));
    }
  });

  it('writes what the register sold so the core side can compare it with PostgreSQL', () => {
    const summary: RegisterSummary = {
      sales: rungUp.length,
      totalCents: rungUp.reduce((sum, sale) => sum + sale.totalCents, 0),
      operations: operationCount,
      saleIds: rungUp.map(({ saleId }) => saleId),
    };
    writeFileSync(core.summaryPath, JSON.stringify(summary));
    expect(summary.sales).toBe(SALES);
  });
});
