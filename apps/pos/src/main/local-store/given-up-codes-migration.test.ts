import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalStore } from './local-store';
import { MIGRATIONS } from './migrations';

const TENANT = 'tenant-a';
const RELEASE_MIGRATION = 24;

let directory: string;
let databasePath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'given-up-codes-'));
  databasePath = join(directory, 'pos.db');
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** A register as it was before E1-62: a product given up from the panel still holds its code. */
function seedBeforeRelease(): void {
  const store = LocalStore.open({ path: databasePath, appVersion: '1.0.0', migrations: MIGRATIONS.filter(({ version }) => version < RELEASE_MIGRATION) });
  try {
    store.transaction((connection) => {
      const insertProduct = connection.prepare(
        "INSERT INTO product (id, tenant_id, name, base_unit, unit_price_e4, tax_factor, tax_rate_bp, is_active) VALUES (?, ?, ?, 'piece', 100000, 'rate', 1600, ?)",
      );
      insertProduct.run('given-up', TENANT, 'Martillo viejo', 0);
      insertProduct.run('arrived-inactive', TENANT, 'Pinza', 0);
      insertProduct.run('active', TENANT, 'Serrucho', 1);
      const insertCode = connection.prepare('INSERT INTO product_barcode (tenant_id, code, product_id) VALUES (?, ?, ?)');
      insertCode.run(TENANT, '111', 'given-up');
      insertCode.run(TENANT, '222', 'arrived-inactive');
      insertCode.run(TENANT, '333', 'active');
      const insertAudit = connection.prepare("INSERT INTO audit_log (id, tenant_id, user_id, action, entity, entity_id, detail, occurred_at) VALUES (?, ?, ?, ?, 'product', ?, ?, ?)");
      insertAudit.run('a1', TENANT, 'owner-1', 'product.update', 'given-up', 'Martillo viejo: state active -> inactive; approved by owner-1', '2026-11-01T10:00:00.000Z');
      insertAudit.run('a2', TENANT, 'owner-1', 'product.update', 'given-up', 'Martillo viejo: name "A" -> "B"; approved by owner-1', '2026-11-02T10:00:00.000Z');
    });
  } finally {
    store.close();
  }
}

describe('the migration that releases the codes of the given-up products (E1-62)', () => {
  it('moves the codes of the products already given up to the history, with the date of the audit log when it has one', () => {
    seedBeforeRelease();
    const store = LocalStore.open({ path: databasePath, appVersion: '1.0.0' });
    try {
      expect(store.prepare('SELECT code, product_id FROM product_barcode ORDER BY code').all()).toEqual([{ code: '333', product_id: 'active' }]);
      expect(store.prepare('SELECT code, product_id, released_at, released_by, restored_at FROM product_code_history ORDER BY code').all()).toEqual([
        { code: '111', product_id: 'given-up', released_at: '2026-11-01T10:00:00.000Z', released_by: 'owner-1', restored_at: null },
        { code: '222', product_id: 'arrived-inactive', released_at: expect.any(String), released_by: 'migration', restored_at: null },
      ]);
      expect(store.prepare('SELECT id, given_up_at, given_up_by FROM product ORDER BY id').all()).toEqual([
        { id: 'active', given_up_at: null, given_up_by: null },
        { id: 'arrived-inactive', given_up_at: null, given_up_by: null },
        { id: 'given-up', given_up_at: '2026-11-01T10:00:00.000Z', given_up_by: 'owner-1' },
      ]);
    } finally {
      store.close();
    }
  });

  it('keeps the history append-only: what a row says never changes, it is restored once, and it is never deleted', () => {
    seedBeforeRelease();
    const store = LocalStore.open({ path: databasePath, appVersion: '1.0.0' });
    try {
      expect(() => store.prepare("UPDATE product_code_history SET code = 'X' WHERE code = '111'").run()).toThrow(/never changes/);
      expect(() => store.prepare("DELETE FROM product_code_history WHERE code = '111'").run()).toThrow(/never deleted/);
      store.prepare("UPDATE product_code_history SET restored_at = '2026-11-25T00:00:00.000Z', restored_by = 'owner-1' WHERE code = '111'").run();
      expect(() => store.prepare("UPDATE product_code_history SET restored_at = '2026-11-26T00:00:00.000Z', restored_by = 'owner-1' WHERE code = '111'").run()).toThrow(/only once/);
    } finally {
      store.close();
    }
  });
});
