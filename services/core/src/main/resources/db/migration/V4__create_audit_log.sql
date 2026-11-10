-- F0-12: append-only audit log (ADR 0038). It records who changed what, when, and the value before and after.
-- It cannot be edited: the application role has no UPDATE, DELETE or TRUNCATE, and a trigger rejects them
-- for every role, the table owner included.
CREATE TABLE audit_log
(
    id          uuid PRIMARY KEY     DEFAULT uuid_v7(),
    -- No foreign key to tenant: the log must outlive the rows it describes.
    tenant_id   uuid        NOT NULL DEFAULT current_tenant_id(),
    -- The user who acted; empty for an action of the system itself.
    actor_id    uuid,
    action      text        NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.]{2,63}$'),
    entity_type text        NOT NULL CHECK (entity_type ~ '^[a-z][a-z0-9_]{1,63}$'),
    entity_id   uuid        NOT NULL,
    old_value   jsonb,
    new_value   jsonb,
    created_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT audit_log_id_is_uuid_v7 CHECK (is_uuid_v7(id))
);

CREATE INDEX audit_log_entity_idx ON audit_log (tenant_id, entity_type, entity_id, created_at);
CREATE INDEX audit_log_created_idx ON audit_log (tenant_id, created_at);

CREATE FUNCTION audit_log_is_append_only() RETURNS trigger
    LANGUAGE plpgsql AS
$$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only: % is not allowed', TG_OP USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER audit_log_no_update_delete
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_log_is_append_only();
CREATE TRIGGER audit_log_no_truncate
    BEFORE TRUNCATE ON audit_log
    FOR EACH STATEMENT EXECUTE FUNCTION audit_log_is_append_only();

-- The default privileges of V2 grant every operation; this table only allows reading and appending.
REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM pos_app;

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY audit_log_isolation ON audit_log
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
