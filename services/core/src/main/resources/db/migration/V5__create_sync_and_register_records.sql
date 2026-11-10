-- E1-17: what the core receives from the registers (ADR 0046).
-- sync_operation is the idempotency anchor: one row per operation of a business, unique on (tenant_id, op_id).
-- The other tables are the records that the operations create. Every business table carries tenant_id and
-- row-level security (ADR 0035). None has a foreign key to tenant, so the records outlive any change to it
-- (same as audit_log), and ids sent by a register are keyed by (tenant_id, id): another business can never
-- collide with them nor learn that they exist.

-- Rejects UPDATE and DELETE for every role, the table owner included. Applied to the records that never change:
-- a completed sale is not edited (ADR 0030) and the stock ledger is a ledger (RF-029).
CREATE FUNCTION reject_modification() RETURNS trigger
    LANGUAGE plpgsql AS
$$
BEGIN
    RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TABLE sync_operation
(
    id             uuid PRIMARY KEY     DEFAULT uuid_v7(),
    tenant_id      uuid        NOT NULL DEFAULT current_tenant_id(),
    -- The idempotency key chosen by the register (UUIDv7). The unique constraint is what makes a repeated
    -- or concurrent batch store each operation once. device_seq is never used to reject (ADR 0040).
    op_id          uuid        NOT NULL,
    register_id    uuid        NOT NULL,
    device_seq     bigint,
    type           text        NOT NULL,
    schema_version integer,
    occurred_at    timestamptz,
    received_at    timestamptz NOT NULL DEFAULT now(),
    status         text        NOT NULL CHECK (status IN ('accepted', 'quarantined')),
    -- Why a quarantined operation was kept apart, for the owner to review (RF-022).
    reason         text CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 500),
    -- The whole operation exactly as it arrived, even when it is invalid: a quarantined sale is never lost.
    raw_operation  jsonb       NOT NULL,
    CONSTRAINT sync_operation_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT sync_operation_op_id_per_tenant UNIQUE (tenant_id, op_id),
    CONSTRAINT sync_operation_reason_iff_quarantined CHECK ((status = 'quarantined') = (reason IS NOT NULL))
);

CREATE INDEX sync_operation_register_idx ON sync_operation (tenant_id, register_id, received_at);
CREATE INDEX sync_operation_quarantine_idx ON sync_operation (tenant_id, received_at) WHERE status = 'quarantined';

-- sales ---------------------------------------------------------------------------------------------------------

CREATE TABLE sale
(
    tenant_id       uuid        NOT NULL DEFAULT current_tenant_id(),
    id              uuid        NOT NULL,
    op_id           uuid        NOT NULL,
    register_id     uuid        NOT NULL,
    folio           bigint      NOT NULL CHECK (folio >= 1),
    cash_session_id uuid,
    cashier_id      uuid,
    completed_at    timestamptz NOT NULL,
    received_at     timestamptz NOT NULL DEFAULT now(),
    subtotal_cents  bigint      NOT NULL CHECK (subtotal_cents >= 0),
    tax_cents       bigint      NOT NULL CHECK (tax_cents >= 0),
    total_cents     bigint      NOT NULL CHECK (total_cents >= 1),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT sale_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT sale_totals_add_up CHECK (subtotal_cents + tax_cents = total_cents),
    CONSTRAINT sale_op_unique UNIQUE (tenant_id, op_id)
);

CREATE INDEX sale_register_idx ON sale (tenant_id, register_id, completed_at);

CREATE TABLE sale_line
(
    tenant_id        uuid    NOT NULL DEFAULT current_tenant_id(),
    id               uuid    NOT NULL,
    sale_id          uuid    NOT NULL,
    line_number      bigint  NOT NULL CHECK (line_number >= 1),
    -- No foreign key yet: the catalog arrives with its own tables (E1-18).
    product_id       uuid    NOT NULL,
    product_name     text    NOT NULL CHECK (length(product_name) BETWEEN 1 AND 500),
    unit             text    NOT NULL CHECK (unit IN ('piece', 'meter', 'kilogram', 'liter')),
    quantity_milli   bigint  NOT NULL CHECK (quantity_milli >= 1),
    unit_price_e4    bigint  NOT NULL CHECK (unit_price_e4 >= 0),
    tax_factor       text    NOT NULL CHECK (tax_factor IN ('rate', 'exempt')),
    tax_rate_bp      integer NOT NULL CHECK (tax_rate_bp BETWEEN 0 AND 10000),
    subtotal_cents   bigint  NOT NULL CHECK (subtotal_cents >= 0),
    tax_cents        bigint  NOT NULL CHECK (tax_cents >= 0),
    line_total_cents bigint  NOT NULL CHECK (line_total_cents >= 0),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT sale_line_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT sale_line_number_unique UNIQUE (tenant_id, sale_id, line_number),
    CONSTRAINT sale_line_sale_fk FOREIGN KEY (tenant_id, sale_id) REFERENCES sale (tenant_id, id)
);

CREATE INDEX sale_line_product_idx ON sale_line (tenant_id, product_id);

CREATE TABLE sale_payment
(
    tenant_id    uuid   NOT NULL DEFAULT current_tenant_id(),
    id           uuid   NOT NULL,
    sale_id      uuid   NOT NULL,
    method       text   NOT NULL CHECK (method IN ('cash', 'transfer', 'card', 'card_manual')),
    amount_cents bigint NOT NULL CHECK (amount_cents >= 1),
    reference    text CHECK (reference IS NULL OR length(reference) <= 100),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT sale_payment_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT sale_payment_sale_fk FOREIGN KEY (tenant_id, sale_id) REFERENCES sale (tenant_id, id)
);

CREATE INDEX sale_payment_sale_idx ON sale_payment (tenant_id, sale_id);

CREATE TABLE sale_return
(
    tenant_id       uuid        NOT NULL DEFAULT current_tenant_id(),
    id              uuid        NOT NULL,
    op_id           uuid        NOT NULL,
    sale_id         uuid        NOT NULL,
    cash_session_id uuid        NOT NULL,
    requested_by    uuid        NOT NULL,
    authorized_by   uuid        NOT NULL,
    reason          text        NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
    total_cents     bigint      NOT NULL CHECK (total_cents >= 1),
    received_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT sale_return_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT sale_return_op_unique UNIQUE (tenant_id, op_id),
    -- A return of a sale the core does not have is refused, and the operation goes to quarantine.
    CONSTRAINT sale_return_sale_fk FOREIGN KEY (tenant_id, sale_id) REFERENCES sale (tenant_id, id)
);

CREATE INDEX sale_return_sale_idx ON sale_return (tenant_id, sale_id);

CREATE TABLE sale_return_line
(
    tenant_id      uuid   NOT NULL DEFAULT current_tenant_id(),
    id             uuid   NOT NULL,
    return_id      uuid   NOT NULL,
    sale_line_id   uuid   NOT NULL,
    quantity_milli bigint NOT NULL CHECK (quantity_milli >= 1),
    refund_cents   bigint NOT NULL CHECK (refund_cents >= 1),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT sale_return_line_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT sale_return_line_return_fk FOREIGN KEY (tenant_id, return_id) REFERENCES sale_return (tenant_id, id),
    CONSTRAINT sale_return_line_sale_line_fk FOREIGN KEY (tenant_id, sale_line_id) REFERENCES sale_line (tenant_id, id)
);

CREATE INDEX sale_return_line_sale_line_idx ON sale_return_line (tenant_id, sale_line_id);

CREATE TABLE sale_return_refund
(
    tenant_id    uuid   NOT NULL DEFAULT current_tenant_id(),
    id           uuid   NOT NULL,
    return_id    uuid   NOT NULL,
    method       text   NOT NULL CHECK (method IN ('cash', 'transfer', 'card', 'card_manual')),
    amount_cents bigint NOT NULL CHECK (amount_cents >= 1),
    reference    text CHECK (reference IS NULL OR length(reference) <= 100),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT sale_return_refund_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT sale_return_refund_return_fk FOREIGN KEY (tenant_id, return_id) REFERENCES sale_return (tenant_id, id)
);

-- cash ----------------------------------------------------------------------------------------------------------

CREATE TABLE cash_session
(
    tenant_id           uuid        NOT NULL DEFAULT current_tenant_id(),
    id                  uuid        NOT NULL,
    op_id               uuid        NOT NULL,
    register_id         uuid        NOT NULL,
    opened_by           uuid        NOT NULL,
    opening_float_cents bigint      NOT NULL CHECK (opening_float_cents >= 0),
    opened_at           timestamptz NOT NULL,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT cash_session_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT cash_session_op_unique UNIQUE (tenant_id, op_id)
);

CREATE TABLE cash_movement
(
    tenant_id     uuid        NOT NULL DEFAULT current_tenant_id(),
    id            uuid        NOT NULL,
    op_id         uuid        NOT NULL,
    session_id    uuid        NOT NULL,
    kind          text        NOT NULL CHECK (kind IN ('in', 'out')),
    amount_cents  bigint      NOT NULL CHECK (amount_cents >= 1),
    reason        text        NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
    recorded_by   uuid        NOT NULL,
    authorized_by uuid,
    occurred_at   timestamptz NOT NULL,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT cash_movement_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT cash_movement_op_unique UNIQUE (tenant_id, op_id),
    CONSTRAINT cash_movement_session_fk FOREIGN KEY (tenant_id, session_id) REFERENCES cash_session (tenant_id, id)
);

CREATE INDEX cash_movement_session_idx ON cash_movement (tenant_id, session_id);

-- The cut that closes a session. A session has at most one cut, and nothing edits it afterwards.
CREATE TABLE cash_cut
(
    tenant_id               uuid        NOT NULL DEFAULT current_tenant_id(),
    id                      uuid        NOT NULL,
    op_id                   uuid        NOT NULL,
    session_id              uuid        NOT NULL,
    closed_by               uuid        NOT NULL,
    -- What the register expected may be negative when refunds exceed sales; what was counted never is.
    expected_cash_cents     bigint      NOT NULL,
    expected_card_cents     bigint      NOT NULL,
    expected_transfer_cents bigint      NOT NULL,
    counted_cash_cents      bigint      NOT NULL CHECK (counted_cash_cents >= 0),
    counted_card_cents      bigint      NOT NULL CHECK (counted_card_cents >= 0),
    counted_transfer_cents  bigint      NOT NULL CHECK (counted_transfer_cents >= 0),
    denominations           jsonb       NOT NULL,
    reason                  text CHECK (reason IS NULL OR length(reason) <= 500),
    closed_at               timestamptz NOT NULL,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT cash_cut_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT cash_cut_op_unique UNIQUE (tenant_id, op_id),
    CONSTRAINT cash_cut_one_per_session UNIQUE (tenant_id, session_id),
    CONSTRAINT cash_cut_session_fk FOREIGN KEY (tenant_id, session_id) REFERENCES cash_session (tenant_id, id)
);

-- inventory -----------------------------------------------------------------------------------------------------

-- The stock ledger: the stock of a product is the sum of its movements. Only adjustments and write-offs arrive
-- from a register; the core derives the movements of sales and returns itself (E1-25).
CREATE TABLE stock_movement
(
    tenant_id      uuid        NOT NULL DEFAULT current_tenant_id(),
    id             uuid        NOT NULL,
    op_id          uuid        NOT NULL,
    product_id     uuid        NOT NULL,
    type           text        NOT NULL CHECK (type IN ('adjustment', 'waste')),
    quantity_milli bigint      NOT NULL CHECK (quantity_milli <> 0),
    reason         text        NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
    user_id        uuid        NOT NULL,
    occurred_at    timestamptz NOT NULL,
    received_at    timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT stock_movement_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT stock_movement_op_unique UNIQUE (tenant_id, op_id)
);

CREATE INDEX stock_movement_product_idx ON stock_movement (tenant_id, product_id, occurred_at);

-- Row-level security, append-only protection and privileges -----------------------------------------------------

DO
$$
    DECLARE
        record_table text;
    BEGIN
        FOREACH record_table IN ARRAY ARRAY ['sync_operation', 'sale', 'sale_line', 'sale_payment', 'sale_return',
            'sale_return_line', 'sale_return_refund', 'cash_session', 'cash_movement', 'cash_cut', 'stock_movement']
            LOOP
                EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', record_table);
                EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', record_table);
                EXECUTE format('CREATE POLICY %I ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
                               record_table || '_isolation', record_table);
                -- sync_operation is the only one that changes later: the owner resolves a quarantine (E1-19).
                IF record_table <> 'sync_operation' THEN
                    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION reject_modification()',
                                   record_table || '_append_only', record_table);
                    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON %I FROM pos_app', record_table);
                END IF;
            END LOOP;
    END
$$;

REVOKE DELETE, TRUNCATE ON sync_operation FROM pos_app;
