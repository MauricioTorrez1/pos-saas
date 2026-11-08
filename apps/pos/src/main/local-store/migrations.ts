/** One change to the local database schema. */
export interface Migration {
  /** Position in the list, starting at 1. It becomes the schema version once applied. */
  readonly version: number;
  /** Short name that appears in errors and in `schema_history`. */
  readonly name: string;
  /** Statements to run. They must not manage transactions: the runner wraps them in one. */
  readonly sql: string;
}

/**
 * Every schema change, in order. Registers in the field update when they can, so a migration that
 * has shipped never changes: a correction is a new migration at the end of the list.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'create_schema_history',
    // Describes this device's copy of the schema rather than the business, so it has no tenant_id.
    sql: `
      CREATE TABLE schema_history (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        app_version TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `,
  },
  {
    version: 2,
    name: 'create_catalog',
    // local_rowid is explicit because VACUUM may renumber an implicit rowid, and the search index points at it.
    sql: `
      CREATE TABLE product (
        local_rowid INTEGER PRIMARY KEY,
        id TEXT NOT NULL UNIQUE,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        base_unit TEXT NOT NULL CHECK (base_unit IN ('piece', 'meter', 'kilogram', 'liter')),
        unit_price_e4 INTEGER NOT NULL CHECK (unit_price_e4 >= 0),
        tax_factor TEXT NOT NULL CHECK (tax_factor IN ('rate', 'exempt')),
        tax_rate_bp INTEGER NOT NULL CHECK (tax_rate_bp BETWEEN 0 AND 10000),
        is_sample INTEGER NOT NULL DEFAULT 0 CHECK (is_sample IN (0, 1)),
        CHECK (tax_factor = 'rate' OR tax_rate_bp = 0)
      ) STRICT;

      CREATE TABLE product_barcode (
        tenant_id TEXT NOT NULL,
        code TEXT NOT NULL,
        product_id TEXT NOT NULL REFERENCES product (id) ON DELETE CASCADE,
        PRIMARY KEY (tenant_id, code)
      ) STRICT, WITHOUT ROWID;

      CREATE INDEX product_barcode_by_product ON product_barcode (product_id);

      CREATE VIRTUAL TABLE product_search USING fts5(
        name,
        content = 'product',
        content_rowid = 'local_rowid',
        tokenize = 'unicode61 remove_diacritics 2',
        prefix = '2 3'
      );

      CREATE TRIGGER product_search_after_insert AFTER INSERT ON product BEGIN
        INSERT INTO product_search (rowid, name) VALUES (new.local_rowid, new.name);
      END;

      CREATE TRIGGER product_search_after_delete AFTER DELETE ON product BEGIN
        INSERT INTO product_search (product_search, rowid, name) VALUES ('delete', old.local_rowid, old.name);
      END;

      CREATE TRIGGER product_search_after_rename AFTER UPDATE OF name ON product BEGIN
        INSERT INTO product_search (product_search, rowid, name) VALUES ('delete', old.local_rowid, old.name);
        INSERT INTO product_search (rowid, name) VALUES (new.local_rowid, new.name);
      END;
    `,
  },
  {
    version: 3,
    name: 'create_register_appearance',
    // The allowed colors and sizes live in code, so offering a new one does not need a table rebuild.
    sql: `
      CREATE TABLE register_appearance (
        tenant_id TEXT PRIMARY KEY,
        business_name TEXT NOT NULL,
        accent TEXT NOT NULL,
        text_size TEXT NOT NULL,
        theme TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
    `,
  },
];
