-- E1-41: a register can be revoked (ADR 0054). Its device credential stops working at once; the row stays,
-- so the audit trail and the register keep pointing at it. RLS of register_device (V8) already covers the columns.
ALTER TABLE register_device
    ADD COLUMN revoked_at timestamptz,
    ADD COLUMN revoked_by uuid,
    ADD CONSTRAINT register_device_revoked_by_fk FOREIGN KEY (tenant_id, revoked_by) REFERENCES app_user (tenant_id, id),
    -- Who revoked it is only known when it was revoked.
    ADD CONSTRAINT register_device_revocation_together CHECK ((revoked_at IS NULL) = (revoked_by IS NULL));
