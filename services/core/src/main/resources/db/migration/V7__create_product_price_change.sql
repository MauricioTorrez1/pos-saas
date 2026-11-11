-- E1-40: the price changes that a register uploads (ADR 0053).
-- It is a log, only added to: a price that was charged yesterday stays true even if the owner changes it today.
-- There is no product table yet (F0-16), so a change is kept here whether or not its product exists. The catalog
-- applies it when the product is there, taking the latest row of each product by seq (see the ADR).
CREATE TABLE product_price_change
(
    tenant_id              uuid        NOT NULL DEFAULT current_tenant_id(),
    -- The changeId of the register: one price change is stored once, even if it arrives under another op_id.
    id                     uuid        NOT NULL,
    op_id                  uuid        NOT NULL,
    register_id            uuid        NOT NULL,
    product_id             uuid        NOT NULL,
    previous_unit_price_e4 bigint      NOT NULL CHECK (previous_unit_price_e4 >= 0),
    new_unit_price_e4      bigint      NOT NULL CHECK (new_unit_price_e4 >= 1 AND new_unit_price_e4 <> previous_unit_price_e4),
    changed_by             uuid        NOT NULL,
    authorized_by          uuid        NOT NULL,
    occurred_at            timestamptz NOT NULL,
    received_at            timestamptz NOT NULL DEFAULT now(),
    -- The order in which the core stored the changes. The clock of a register and its device_seq are never used to order.
    seq                    bigint GENERATED ALWAYS AS IDENTITY,
    -- The price the core had for the product when the change arrived, taken from the latest change it holds. It is
    -- null when it had none to compare with (the first change of a product, until the catalog exists).
    server_price_e4        bigint CHECK (server_price_e4 IS NULL OR server_price_e4 >= 0),
    -- RF-022: the register said it changed from a price that is not the one of the core. The change is kept as sent,
    -- and E1-19 shows it to the owner.
    discrepancy            boolean     NOT NULL,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT product_price_change_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT product_price_change_op_unique UNIQUE (tenant_id, op_id),
    CONSTRAINT product_price_change_seq_unique UNIQUE (seq),
    CONSTRAINT product_price_change_discrepancy_needs_a_price CHECK (NOT discrepancy OR server_price_e4 IS NOT NULL)
);

CREATE INDEX product_price_change_product_idx ON product_price_change (tenant_id, product_id, seq DESC);
CREATE INDEX product_price_change_discrepancy_idx ON product_price_change (tenant_id, received_at) WHERE discrepancy;

ALTER TABLE product_price_change ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_price_change FORCE ROW LEVEL SECURITY;
CREATE POLICY product_price_change_isolation ON product_price_change
    USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE TRIGGER product_price_change_append_only BEFORE UPDATE OR DELETE ON product_price_change
    FOR EACH ROW EXECUTE FUNCTION reject_modification();
REVOKE UPDATE, DELETE, TRUNCATE ON product_price_change FROM pos_app;
