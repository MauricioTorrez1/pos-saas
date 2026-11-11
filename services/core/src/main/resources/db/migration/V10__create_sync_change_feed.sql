-- E1-18: the feed of changes that registers download (ADR 0048).
-- Every change to what a register must know (products with their prices, staff permissions) is one row of
-- sync_change, numbered per business by seq. A register keeps the last seq it applied (its cursor) and asks for
-- what came after. A deletion is a row with deleted = true (a tombstone), never a missing row.

-- One row per business that holds the last number handed out. Taking the next number updates this row, so two
-- transactions of one business that publish changes queue up: the second one waits for the first to commit or roll
-- back. That is what makes seq follow the order of the commits and never leave a hole that fills in later, which
-- is the only way a cursor can be trusted not to skip a change that was still in flight.
CREATE TABLE sync_change_counter
(
    tenant_id uuid PRIMARY KEY DEFAULT current_tenant_id(),
    last_seq  bigint NOT NULL DEFAULT 0 CHECK (last_seq >= 0)
);

CREATE TABLE sync_change
(
    tenant_id      uuid        NOT NULL DEFAULT current_tenant_id(),
    seq            bigint      NOT NULL CHECK (seq >= 1),
    entity_type    text        NOT NULL CHECK (entity_type ~ '^[a-z][a-z0-9_]{1,63}$'),
    entity_id      uuid        NOT NULL,
    deleted        boolean     NOT NULL DEFAULT false,
    schema_version integer     NOT NULL DEFAULT 1 CHECK (schema_version >= 1),
    -- The whole state of the entity after the change; absent exactly when it was deleted.
    payload        jsonb,
    changed_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, seq),
    CONSTRAINT sync_change_payload_iff_not_deleted CHECK (deleted = (payload IS NULL))
);

CREATE INDEX sync_change_entity_idx ON sync_change (tenant_id, entity_type, entity_id, seq);

-- The feed is a log: a change is never edited and a tombstone is never removed, because a register that was
-- offline for a month must still learn about the deletion.
CREATE TRIGGER sync_change_append_only
    BEFORE UPDATE OR DELETE ON sync_change
    FOR EACH ROW EXECUTE FUNCTION reject_modification();
REVOKE UPDATE, DELETE, TRUNCATE ON sync_change FROM pos_app;

ALTER TABLE sync_change_counter ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_change_counter FORCE ROW LEVEL SECURITY;
CREATE POLICY sync_change_counter_isolation ON sync_change_counter
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE sync_change ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_change FORCE ROW LEVEL SECURITY;
CREATE POLICY sync_change_isolation ON sync_change
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
