-- E1-24: the e-mail report of each cash cut (ADR 0052).

-- Where the owner receives the reports. Empty until the panel lets the owner set it; the core then uses the
-- default recipient of its configuration, and with neither the report is skipped.
ALTER TABLE tenant
    ADD COLUMN owner_email text
        CONSTRAINT tenant_owner_email_format CHECK (owner_email IS NULL OR owner_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

-- One row per cut and business: the unique key is what keeps a cut from sending two e-mails, even when the
-- cut is uploaded twice or two workers handle the same event. It also records how the delivery went.
CREATE TABLE cut_report_delivery
(
    id              uuid PRIMARY KEY     DEFAULT uuid_v7(),
    tenant_id       uuid        NOT NULL DEFAULT current_tenant_id(),
    cut_id          uuid        NOT NULL,
    -- pending: waiting. sending: a worker has it. sent: the provider accepted it. failed: it will be retried.
    -- gave_up: too many failures. rejected: the provider refused it, so retrying is useless.
    -- skipped: nothing to send with (no key or no recipient).
    status          text        NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'gave_up', 'rejected', 'skipped')),
    attempts        integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    -- A short code or class name, never the body of the e-mail or of the provider answer.
    last_error      text CHECK (last_error IS NULL OR length(last_error) <= 200),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    sent_at         timestamptz,
    CONSTRAINT cut_report_delivery_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT cut_report_delivery_one_per_cut UNIQUE (tenant_id, cut_id)
);

ALTER TABLE cut_report_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE cut_report_delivery FORCE ROW LEVEL SECURITY;
CREATE POLICY cut_report_delivery_isolation ON cut_report_delivery
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
