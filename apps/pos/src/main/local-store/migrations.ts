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
  {
    version: 6,
    name: 'add_sale_folio',
    // The short folio of the ticket. Only completed sales get one, so cancelled sales leave no gap, and it never changes
    // (ADR 0027).
    sql: `
      ALTER TABLE sale ADD COLUMN folio INTEGER CHECK (folio IS NULL OR folio >= 1);

      CREATE UNIQUE INDEX sale_folio_per_business ON sale (tenant_id, folio) WHERE folio IS NOT NULL;

      CREATE TRIGGER sale_completes_with_folio BEFORE UPDATE OF status ON sale
      WHEN NEW.status = 'completed' AND NEW.folio IS NULL
      BEGIN SELECT RAISE(ABORT, 'a completed sale needs its folio'); END;

      CREATE TRIGGER sale_folio_never_changes BEFORE UPDATE OF folio ON sale
      WHEN OLD.folio IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'the folio of a sale never changes'); END;
    `,
  },
  {
    version: 7,
    name: 'accept_manual_card_payments',
    // Replaces the triggers of migration 5, which is how ADR 0026 said a new method would arrive. A card typed on the
    // standalone terminal needs its folio, so it can be reconciled later (ADR 0028).
    sql: `
      DROP TRIGGER payment_has_known_method;
      DROP TRIGGER payment_transfer_has_reference;

      CREATE TRIGGER payment_has_known_method BEFORE INSERT ON payment
      WHEN NEW.method NOT IN ('cash', 'transfer', 'card', 'card_manual')
      BEGIN SELECT RAISE(ABORT, 'unknown payment method'); END;

      CREATE TRIGGER payment_needs_its_reference BEFORE INSERT ON payment
      WHEN NEW.method IN ('transfer', 'card_manual') AND length(trim(coalesce(NEW.reference, ''))) = 0
      BEGIN SELECT RAISE(ABORT, 'a transfer or a card payment needs its reference'); END;
    `,
  },
  {
    version: 8,
    name: 'create_app_user',
    // The people who sign in with a PIN, with or without internet (ADR 0006, ADR 0029). The PIN is only kept as a hash. A
    // person is deactivated, never deleted, because their sales and cuts keep their name.
    sql: `
      CREATE TABLE app_user (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        role TEXT NOT NULL,
        pin_hash TEXT NOT NULL CHECK (length(pin_hash) > 0),
        failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
        locked_until TEXT,
        is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
        created_at TEXT NOT NULL,
        UNIQUE (tenant_id, name)
      ) STRICT;

      CREATE TRIGGER app_user_has_known_role BEFORE INSERT ON app_user
      WHEN NEW.role NOT IN ('owner', 'cashier')
      BEGIN SELECT RAISE(ABORT, 'unknown role'); END;

      CREATE TRIGGER app_user_keeps_its_identity BEFORE UPDATE OF id, tenant_id, name, role ON app_user
      BEGIN SELECT RAISE(ABORT, 'the identity and role of a user never change'); END;

      CREATE TRIGGER app_user_is_never_deleted BEFORE DELETE ON app_user
      BEGIN SELECT RAISE(ABORT, 'a user is never deleted: deactivate them instead'); END;
    `,
  },
  {
    version: 9,
    name: 'create_cash_sessions_and_returns',
    // A cash session is the stretch between opening the register with a float and the cut (ADR 0029). Only one can be open
    // per business. Sales point at the session they were made in and at who made them, and the returns have their own
    // tables because a completed sale never changes: a refund is a record next to it (ADR 0030).
    sql: `
      CREATE TABLE cash_session (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        opened_by TEXT NOT NULL,
        opened_at TEXT NOT NULL,
        opening_float_cents INTEGER NOT NULL CHECK (opening_float_cents >= 0),
        closed_by TEXT,
        closed_at TEXT
      ) STRICT;

      CREATE UNIQUE INDEX cash_session_one_open ON cash_session (tenant_id) WHERE closed_at IS NULL;

      CREATE TRIGGER cash_session_keeps_its_opening BEFORE UPDATE OF id, tenant_id, opened_by, opened_at, opening_float_cents ON cash_session
      BEGIN SELECT RAISE(ABORT, 'how a cash session opened never changes'); END;

      CREATE TRIGGER cash_session_freezes_once_closed BEFORE UPDATE ON cash_session
      WHEN OLD.closed_at IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'a closed cash session never changes'); END;

      CREATE TRIGGER cash_session_is_never_deleted BEFORE DELETE ON cash_session
      BEGIN SELECT RAISE(ABORT, 'a cash session is never deleted'); END;

      CREATE TABLE cash_movement (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        session_id TEXT NOT NULL REFERENCES cash_session (id),
        kind TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
        recorded_by TEXT NOT NULL,
        authorized_by TEXT,
        recorded_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX cash_movement_by_session ON cash_movement (session_id);

      CREATE TRIGGER cash_movement_has_known_kind BEFORE INSERT ON cash_movement
      WHEN NEW.kind NOT IN ('in', 'out')
      BEGIN SELECT RAISE(ABORT, 'a cash movement is an entry or an exit'); END;

      CREATE TRIGGER cash_movement_only_while_open BEFORE INSERT ON cash_movement
      WHEN (SELECT closed_at FROM cash_session WHERE id = NEW.session_id) IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'cash movements can only be added to an open cash session'); END;

      CREATE TRIGGER cash_movement_never_changes BEFORE UPDATE ON cash_movement
      BEGIN SELECT RAISE(ABORT, 'a cash movement never changes'); END;

      CREATE TRIGGER cash_movement_is_never_deleted BEFORE DELETE ON cash_movement
      BEGIN SELECT RAISE(ABORT, 'a cash movement is never deleted'); END;

      CREATE TABLE register_setting (
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        PRIMARY KEY (tenant_id, name)
      ) STRICT, WITHOUT ROWID;

      CREATE TABLE cash_cut (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        session_id TEXT NOT NULL UNIQUE REFERENCES cash_session (id),
        cut_by TEXT NOT NULL,
        cut_at TEXT NOT NULL,
        expected_cash_cents INTEGER NOT NULL,
        counted_cash_cents INTEGER NOT NULL CHECK (counted_cash_cents >= 0),
        expected_card_cents INTEGER NOT NULL,
        counted_card_cents INTEGER NOT NULL CHECK (counted_card_cents >= 0),
        expected_transfer_cents INTEGER NOT NULL,
        counted_transfer_cents INTEGER NOT NULL CHECK (counted_transfer_cents >= 0),
        denominations TEXT NOT NULL,
        reason TEXT
      ) STRICT;

      CREATE TRIGGER cash_cut_never_changes BEFORE UPDATE ON cash_cut
      BEGIN SELECT RAISE(ABORT, 'a cash cut never changes'); END;

      CREATE TRIGGER cash_cut_is_never_deleted BEFORE DELETE ON cash_cut
      BEGIN SELECT RAISE(ABORT, 'a cash cut is never deleted'); END;

      CREATE TRIGGER cash_cut_explains_a_difference BEFORE INSERT ON cash_cut
      WHEN (NEW.expected_cash_cents <> NEW.counted_cash_cents
        OR NEW.expected_card_cents <> NEW.counted_card_cents
        OR NEW.expected_transfer_cents <> NEW.counted_transfer_cents)
        AND length(trim(coalesce(NEW.reason, ''))) = 0
      BEGIN SELECT RAISE(ABORT, 'a cut that does not balance needs its reason'); END;

      ALTER TABLE sale ADD COLUMN cash_session_id TEXT REFERENCES cash_session (id);
      ALTER TABLE sale ADD COLUMN cashier_id TEXT;

      CREATE TRIGGER sale_only_in_open_session BEFORE INSERT ON sale
      WHEN NEW.cash_session_id IS NOT NULL
        AND (SELECT closed_at FROM cash_session WHERE id = NEW.cash_session_id) IS NOT NULL
      BEGIN SELECT RAISE(ABORT, 'a sale can only start in an open cash session'); END;

      CREATE TABLE sale_return (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        sale_id TEXT NOT NULL REFERENCES sale (id),
        cash_session_id TEXT NOT NULL REFERENCES cash_session (id),
        requested_by TEXT NOT NULL,
        authorized_by TEXT NOT NULL,
        reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
        total_cents INTEGER NOT NULL CHECK (total_cents > 0),
        occurred_at TEXT NOT NULL
      ) STRICT;

      CREATE INDEX sale_return_by_sale ON sale_return (sale_id);
      CREATE INDEX sale_return_by_session ON sale_return (cash_session_id);

      CREATE TABLE sale_return_line (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        return_id TEXT NOT NULL REFERENCES sale_return (id),
        sale_line_id TEXT NOT NULL REFERENCES sale_line (id),
        quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
        refund_cents INTEGER NOT NULL CHECK (refund_cents > 0)
      ) STRICT;

      CREATE INDEX sale_return_line_by_line ON sale_return_line (sale_line_id);

      CREATE TABLE refund_payment (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        return_id TEXT NOT NULL REFERENCES sale_return (id),
        method TEXT NOT NULL,
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        reference TEXT
      ) STRICT;

      CREATE INDEX refund_payment_by_return ON refund_payment (return_id);

      CREATE TRIGGER refund_payment_has_known_method BEFORE INSERT ON refund_payment
      WHEN NEW.method NOT IN ('cash', 'transfer', 'card', 'card_manual')
      BEGIN SELECT RAISE(ABORT, 'unknown payment method'); END;

      CREATE TRIGGER sale_return_never_changes BEFORE UPDATE ON sale_return
      BEGIN SELECT RAISE(ABORT, 'a return never changes'); END;

      CREATE TRIGGER sale_return_is_never_deleted BEFORE DELETE ON sale_return
      BEGIN SELECT RAISE(ABORT, 'a return is never deleted'); END;

      CREATE TRIGGER sale_return_line_never_changes BEFORE UPDATE ON sale_return_line
      BEGIN SELECT RAISE(ABORT, 'a return line never changes'); END;

      CREATE TRIGGER sale_return_line_is_never_deleted BEFORE DELETE ON sale_return_line
      BEGIN SELECT RAISE(ABORT, 'a return line is never deleted'); END;

      CREATE TRIGGER refund_payment_never_changes BEFORE UPDATE ON refund_payment
      BEGIN SELECT RAISE(ABORT, 'a refund payment never changes'); END;

      CREATE TRIGGER refund_payment_is_never_deleted BEFORE DELETE ON refund_payment
      BEGIN SELECT RAISE(ABORT, 'a refund payment is never deleted'); END;
    `,
  },
  {
    version: 10,
    name: 'create_stock_movements',
    // Stock is the sum of an immutable ledger, never a column that is updated (ADR 0003, ADR 0031). The same source cannot
    // post the same movement twice, so importing a file again or syncing a sale twice adds nothing.
    sql: `
      CREATE TABLE stock_movement (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        type TEXT NOT NULL,
        quantity_milli INTEGER NOT NULL CHECK (quantity_milli <> 0),
        unit_cost_e6 INTEGER CHECK (unit_cost_e6 IS NULL OR unit_cost_e6 >= 0),
        source TEXT NOT NULL,
        source_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL
      ) STRICT;

      CREATE UNIQUE INDEX stock_movement_once_per_source ON stock_movement (tenant_id, source, source_id, product_id);
      CREATE INDEX stock_movement_by_product ON stock_movement (tenant_id, product_id);

      CREATE TRIGGER stock_movement_has_known_type BEFORE INSERT ON stock_movement
      WHEN NEW.type NOT IN ('opening_balance', 'sale', 'return', 'adjustment', 'waste')
      BEGIN SELECT RAISE(ABORT, 'unknown stock movement type'); END;

      CREATE TRIGGER stock_movement_never_changes BEFORE UPDATE ON stock_movement
      BEGIN SELECT RAISE(ABORT, 'a stock movement never changes'); END;

      CREATE TRIGGER stock_movement_is_never_deleted BEFORE DELETE ON stock_movement
      BEGIN SELECT RAISE(ABORT, 'a stock movement is never deleted'); END;
    `,
  },
];