-- E1-28: entries of stock with a cost (ADR 0049).
-- The average cost is never stored: it is replayed from the ledger, so the only new fact the core needs is
-- what came in and at what cost. Sales, returns and adjustments are already in sale_line, sale_return_line
-- and stock_movement.

CREATE TABLE stock_receipt
(
    tenant_id      uuid        NOT NULL DEFAULT current_tenant_id(),
    id             uuid        NOT NULL,
    -- Idempotency key of the entry (UUIDv7): a repeated entry is stored once.
    op_id          uuid        NOT NULL,
    product_id     uuid        NOT NULL,
    source         text        NOT NULL CHECK (source IN ('purchase', 'opening_balance')),
    -- Units that came in, in thousandths. An entry always adds stock.
    quantity_milli bigint      NOT NULL CHECK (quantity_milli >= 1),
    -- Cost of one unit in millionths of a peso (ADR 0011). Zero is allowed: a free sample is still stock.
    unit_cost_e6   bigint      NOT NULL CHECK (unit_cost_e6 >= 0),
    -- When the goods arrived. A late entry is replayed at this moment, not at received_at.
    occurred_at    timestamptz NOT NULL,
    received_at    timestamptz NOT NULL DEFAULT now(),
    created_by     uuid,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT stock_receipt_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT stock_receipt_op_unique UNIQUE (tenant_id, op_id)
);

CREATE INDEX stock_receipt_product_idx ON stock_receipt (tenant_id, product_id, occurred_at);

ALTER TABLE stock_receipt ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_receipt FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_receipt_isolation ON stock_receipt
    USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());

-- A ledger: an entry is corrected with another entry, never edited.
CREATE TRIGGER stock_receipt_append_only BEFORE UPDATE OR DELETE ON stock_receipt
    FOR EACH ROW EXECUTE FUNCTION reject_modification();
REVOKE UPDATE, DELETE, TRUNCATE ON stock_receipt FROM pos_app;
