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
  {
    version: 4,
    name: 'create_sales',
    // The states and payment methods live in triggers and code rather than in CHECK constraints, because a later
    // migration can replace a trigger, while changing a CHECK means rebuilding the table (ADR 0025). product_id has no
    // foreign key: a line is a record of what was sold, and it must outlive a product removed from the catalog.
    sql: `
      CREATE TABLE sale (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL,
        subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
        tax_cents INTEGER NOT NULL CHECK (tax_cents >= 0),
        total_cents INTEGER NOT NULL CHECK (total_cents > 0),
        occurred_at TEXT NOT NULL,
        resolved_at TEXT,
        CHECK (subtotal_cents + tax_cents = total_cents),
        UNIQUE (tenant_id, idempotency_key)
      ) STRICT;

      CREATE INDEX sale_pending ON sale (tenant_id, id) WHERE status = 'pending_payment';

      CREATE TABLE sale_line (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        sale_id TEXT NOT NULL REFERENCES sale (id),
        line_number INTEGER NOT NULL CHECK (line_number >= 1),
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL CHECK (length(trim(product_name)) > 0),
        unit TEXT NOT NULL CHECK (unit IN ('piece', 'meter', 'kilogram', 'liter')),
        quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
        unit_price_e4 INTEGER NOT NULL CHECK (unit_price_e4 >= 0),
        tax_factor TEXT NOT NULL CHECK (tax_factor IN ('rate', 'exempt')),
        tax_rate_bp INTEGER NOT NULL CHECK (tax_rate_bp BETWEEN 0 AND 10000),
        subtotal_cents INTEGER NOT NULL CHECK (subtotal_cents >= 0),
        tax_cents INTEGER NOT NULL CHECK (tax_cents >= 0),
        line_total_cents INTEGER NOT NULL CHECK (line_total_cents >= 0),
        CHECK (tax_factor = 'rate' OR tax_rate_bp = 0),
        CHECK (subtotal_cents + tax_cents = line_total_cents),
        UNIQUE (sale_id, line_number)
      ) STRICT;

      CREATE TABLE payment (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        sale_id TEXT NOT NULL REFERENCES sale (id),
        method TEXT NOT NULL CHECK (length(method) > 0),
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        reference TEXT,
        recorded_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX payment_by_sale ON payment (sale_id);

      CREATE VIEW counted_sale AS
        SELECT id, tenant_id, subtotal_cents, tax_cents, total_cents, occurred_at FROM sale WHERE status = 'completed';

      CREATE TRIGGER sale_starts_pending BEFORE INSERT ON sale
      WHEN NEW.status <> 'pending_payment'
      BEGIN SELECT RAISE(ABORT, 'a sale must start as pending_payment'); END;

      CREATE TRIGGER sale_follows_state_machine BEFORE UPDATE OF status ON sale
      WHEN NOT (OLD.status = 'pending_payment' AND NEW.status IN ('completed', 'cancelled'))
      BEGIN SELECT RAISE(ABORT, 'invalid sale transition'); END;

      CREATE TRIGGER sale_completes_fully_paid BEFORE UPDATE OF status ON sale
      WHEN NEW.status = 'completed'
        AND (SELECT coalesce(sum(amount_cents), 0) FROM payment WHERE sale_id = NEW.id) <> OLD.total_cents
      BEGIN SELECT RAISE(ABORT, 'the payments of a completed sale must add up to its total'); END;

      CREATE TRIGGER sale_freezes_once_resolved BEFORE UPDATE ON sale
      WHEN OLD.status <> 'pending_payment'
      BEGIN SELECT RAISE(ABORT, 'a resolved sale never changes'); END;

      CREATE TRIGGER sale_keeps_its_facts
      BEFORE UPDATE OF id, tenant_id, idempotency_key, subtotal_cents, tax_cents, total_cents, occurred_at ON sale
      BEGIN SELECT RAISE(ABORT, 'the amounts and identity of a sale never change'); END;

      CREATE TRIGGER sale_is_never_deleted BEFORE DELETE ON sale
      BEGIN SELECT RAISE(ABORT, 'a sale is never deleted: cancel it instead'); END;

      CREATE TRIGGER sale_line_only_while_pending BEFORE INSERT ON sale_line
      WHEN (SELECT status FROM sale WHERE id = NEW.sale_id) IS NOT 'pending_payment'
      BEGIN SELECT RAISE(ABORT, 'lines can only be added to a pending sale'); END;

      CREATE TRIGGER sale_line_never_changes BEFORE UPDATE ON sale_line
      BEGIN SELECT RAISE(ABORT, 'a sale line never changes'); END;

      CREATE TRIGGER sale_line_is_never_deleted BEFORE DELETE ON sale_line
      BEGIN SELECT RAISE(ABORT, 'a sale line is never deleted'); END;

      CREATE TRIGGER payment_only_while_pending BEFORE INSERT ON payment
      WHEN (SELECT status FROM sale WHERE id = NEW.sale_id) IS NOT 'pending_payment'
      BEGIN SELECT RAISE(ABORT, 'payments can only be added to a pending sale'); END;

      CREATE TRIGGER payment_never_changes BEFORE UPDATE ON payment
      BEGIN SELECT RAISE(ABORT, 'a payment never changes'); END;

      CREATE TRIGGER payment_is_never_deleted BEFORE DELETE ON payment
      BEGIN SELECT RAISE(ABORT, 'a payment is never deleted'); END;
    `,
  },
  {
    version: 5,
    name: 'validate_payment_methods',
    // The methods live in a trigger rather than a CHECK, so E1-12 can add card_manual by replacing it (ADR 0026).
    sql: `
      CREATE TRIGGER payment_has_known_method BEFORE INSERT ON payment
      WHEN NEW.method NOT IN ('cash', 'transfer', 'card')
      BEGIN SELECT RAISE(ABORT, 'unknown payment method'); END;

      CREATE TRIGGER payment_transfer_has_reference BEFORE INSERT ON payment
      WHEN NEW.method = 'transfer' AND length(trim(coalesce(NEW.reference, ''))) = 0
      BEGIN SELECT RAISE(ABORT, 'a transfer needs its reference'); END;
    `,
  },
];