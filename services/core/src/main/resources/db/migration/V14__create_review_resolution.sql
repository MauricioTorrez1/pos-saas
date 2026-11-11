-- E1-19: how the owner resolved what the core could not apply (ADR 0055).
-- A review item is either a quarantined operation (sync_operation.status = 'quarantined', subject = its op_id) or a
-- price discrepancy (product_price_change.discrepancy, subject = its id). Neither table is edited to say "resolved":
-- this log says it. UNIQUE (tenant_id, kind, subject_id) is what lets only one of two simultaneous resolutions win, and
-- the log is only added to, so who resolved what and when can never be rewritten.
CREATE TABLE review_resolution
(
    id                uuid PRIMARY KEY     DEFAULT uuid_v7(),
    tenant_id         uuid        NOT NULL DEFAULT current_tenant_id(),
    kind              text        NOT NULL CHECK (kind IN ('quarantine', 'discrepancy')),
    subject_id        uuid        NOT NULL,
    action            text        NOT NULL CHECK (action IN ('accepted', 'rejected', 'corrected')),
    -- Why, in the words of the owner. Required to reject or to correct. It never goes to the audit log.
    reason            text CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 500),
    -- The payload that replaced the original one, when the owner corrected it before applying it again.
    corrected_payload jsonb,
    resolved_by       uuid        NOT NULL,
    resolved_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT review_resolution_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT review_resolution_one_per_subject UNIQUE (tenant_id, kind, subject_id),
    CONSTRAINT review_resolution_reason_when_needed CHECK (action = 'accepted' OR reason IS NOT NULL),
    CONSTRAINT review_resolution_payload_iff_corrected CHECK ((action = 'corrected') = (corrected_payload IS NOT NULL)),
    CONSTRAINT review_resolution_corrects_only_quarantine CHECK (action <> 'corrected' OR kind = 'quarantine')
);

ALTER TABLE review_resolution ENABLE ROW LEVEL SECURITY;
ALTER TABLE review_resolution FORCE ROW LEVEL SECURITY;
CREATE POLICY review_resolution_isolation ON review_resolution
    USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE TRIGGER review_resolution_append_only BEFORE UPDATE OR DELETE ON review_resolution
    FOR EACH ROW EXECUTE FUNCTION reject_modification();
REVOKE UPDATE, DELETE, TRUNCATE ON review_resolution FROM pos_app;
