import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { uuidV7 } from '../uuid-v7';
import { LocalStore } from './local-store';
import { ProductCatalog } from './product-catalog';

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';
const RESULT_LIMIT = 20;

let directory: string;
let store: LocalStore;
let catalog: ProductCatalog;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'product-catalog-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  catalog = new ProductCatalog(store, TENANT);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function addProduct(name: string, code?: string, tenantId: string = TENANT): string {
  const id = uuidV7();
  store.transaction((connection) => {
    connection
      .prepare(
        `INSERT INTO product (id, tenant_id, name, base_unit, unit_price_e4, tax_factor, tax_rate_bp)
         VALUES (?, ?, ?, 'piece', 1160000, 'rate', 1600)`,
      )
      .run(id, tenantId, name);
    if (code !== undefined) {
      connection.prepare('INSERT INTO product_barcode (tenant_id, code, product_id) VALUES (?, ?, ?)').run(tenantId, code, id);
    }
  });
  return id;
}

function namesFound(text: string): string[] {
  return catalog.search(text, RESULT_LIMIT).map(({ name }) => name);
}

describe('findByCode', () => {
  it('returns the product with its price, unit, and tax rate', () => {
    const id = addProduct('Martillo', '7501');

    expect(catalog.findByCode('7501')).toEqual({
      id,
      name: 'Martillo',
      unit: 'piece',
      unitPriceE4: 1160000,
      taxRate: { factor: 'rate', rateBp: 1600 },
    });
  });

  it('ignores the spaces a scanner or a person can leave around the code', () => {
    addProduct('Martillo', '7501');

    expect(catalog.findByCode('  7501 ')?.name).toBe('Martillo');
  });

  it('returns null for a code nobody has, and never matches part of a code', () => {
    addProduct('Martillo', '7501');

    expect(catalog.findByCode('750')).toBeNull();
    expect(catalog.findByCode('9999')).toBeNull();
  });

  it('finds a product through any of its codes', () => {
    const id = addProduct('Martillo', '7501');
    store.transaction((connection) => {
      connection.prepare('INSERT INTO product_barcode (tenant_id, code, product_id) VALUES (?, ?, ?)').run(TENANT, '7502', id);
    });

    expect(catalog.findByCode('7502')?.id).toBe(id);
  });

  it('never returns a product of another business', () => {
    addProduct('Ajeno', '7501', OTHER_TENANT);

    expect(catalog.findByCode('7501')).toBeNull();
  });

  it('refuses to give one code to two products of the same business', () => {
    addProduct('Martillo', '7501');

    expect(() => addProduct('Pinzas', '7501')).toThrow(/UNIQUE/);
  });
});

describe('search', () => {
  it('finds a product by the beginning of a word', () => {
    addProduct('Martillo uña curva');
    addProduct('Pinzas de electricista');

    expect(namesFound('mart')).toEqual(['Martillo uña curva']);
  });

  it('needs every typed word to match', () => {
    addProduct('Cable calibre 12');
    addProduct('Cable calibre 14');

    expect(namesFound('cable 12')).toEqual(['Cable calibre 12']);
  });

  it('ignores accents and capitals, in the name and in the text', () => {
    addProduct('Flexómetro');
    addProduct('TUBERIA');

    expect(namesFound('FLEXOMETRO')).toEqual(['Flexómetro']);
    expect(namesFound('tubería')).toEqual(['TUBERIA']);
  });

  it.each(['AND', 'NEAR(', 'name:', '"', '*', '- -', 'a"b*('])('treats %s as plain text and does not fail', (text) => {
    addProduct('Martillo');

    expect(() => namesFound(text)).not.toThrow();
  });

  it('finds measures written with symbols', () => {
    addProduct('Manguera 1/2"');
    addProduct('Manguera 3/4"');

    expect(namesFound('1/2"')).toEqual(['Manguera 1/2"']);
  });

  it('returns nothing for text with no letters or digits, without searching', () => {
    addProduct('Martillo');

    expect(namesFound('  -- ')).toEqual([]);
    expect(namesFound('')).toEqual([]);
  });

  it('stops at the limit', () => {
    for (let number = 1; number <= 5; number += 1) {
      addProduct(`Tornillo ${number}`);
    }

    expect(catalog.search('tornillo', 3)).toHaveLength(3);
  });

  it('never returns a product of another business', () => {
    addProduct('Martillo ajeno', undefined, OTHER_TENANT);

    expect(namesFound('martillo')).toEqual([]);
  });

  it('follows a change of name', () => {
    const id = addProduct('Martillo');
    store.transaction((connection) => {
      connection.prepare('UPDATE product SET name = ? WHERE id = ?').run('Mazo', id);
    });

    expect(namesFound('martillo')).toEqual([]);
    expect(namesFound('mazo')).toEqual(['Mazo']);
  });

  it('forgets a deleted product', () => {
    const id = addProduct('Martillo');
    store.transaction((connection) => {
      connection.prepare('DELETE FROM product WHERE id = ?').run(id);
    });

    expect(namesFound('martillo')).toEqual([]);
  });
});

describe('catalog tables', () => {
  it.each([
    ['a negative price', "'x', 'piece', -1, 'rate', 1600"],
    ['an unknown unit', "'x', 'box', 1, 'rate', 1600"],
    ['an exempt product with a rate', "'x', 'piece', 1, 'exempt', 1600"],
    ['a rate above 100%', "'x', 'piece', 1, 'rate', 10001"],
    ['a blank name', "'   ', 'piece', 1, 'rate', 1600"],
    ['a price with decimals', "'x', 'piece', 1.5, 'rate', 1600"],
  ])('refuses %s', (_description, values) => {
    expect(() =>
      store.transaction((connection) => {
        connection.exec(
          `INSERT INTO product (id, tenant_id, name, base_unit, unit_price_e4, tax_factor, tax_rate_bp) VALUES ('p', 't', ${values})`,
        );
      }),
    ).toThrow();
  });
});
