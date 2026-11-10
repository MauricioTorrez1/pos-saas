-- E1-31: one CFDI invoice per sale (ADR 0050).
-- The unique constraint on (tenant_id, sale_id) is what stops a second invoice for the same sale, however many
-- retries or concurrent requests arrive. The row is also the state machine of the stamping:
--   pending  -> an attempt started and its outcome is not known yet (or it is still running),
--   stamped  -> the provider returned the fiscal UUID,
--   failed   -> the provider refused it, or it could not be called; the receiver data can be corrected and resent.
-- Personal data is minimal on purpose: only the receiver's RFC is kept (to find invoices by customer). Name,
-- regime, ZIP code and e-mail travel to the provider and are not stored here. The PDF and the XML are not stored
-- either: provider_invoice_id is the reference they are downloaded with on demand.
CREATE TABLE invoice
(
    tenant_id            uuid        NOT NULL DEFAULT current_tenant_id(),
    id                   uuid        NOT NULL,
    sale_id              uuid        NOT NULL,
    status               text        NOT NULL CHECK (status IN ('pending', 'stamped', 'failed')),
    receiver_tax_id      text        NOT NULL CHECK (length(receiver_tax_id) BETWEEN 12 AND 13),
    provider_invoice_id  text,
    fiscal_uuid          uuid,
    total_cents          bigint CHECK (total_cents IS NULL OR total_cents >= 0),
    -- A short code that never carries fiscal data: provider_rejected, provider_not_configured, provider_unavailable.
    error_code           text CHECK (error_code IS NULL OR error_code ~ '^[a-z_]{3,64}$'),
    provider_http_status integer,
    attempts             integer     NOT NULL DEFAULT 1 CHECK (attempts >= 1),
    attempt_started_at   timestamptz NOT NULL DEFAULT now(),
    requested_by         uuid,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    stamped_at           timestamptz,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT invoice_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT invoice_one_per_sale UNIQUE (tenant_id, sale_id),
    CONSTRAINT invoice_sale_fk FOREIGN KEY (tenant_id, sale_id) REFERENCES sale (tenant_id, id),
    CONSTRAINT invoice_stamped_iff_fiscal_uuid CHECK ((status = 'stamped') = (fiscal_uuid IS NOT NULL AND provider_invoice_id IS NOT NULL))
);

-- One fiscal UUID belongs to one invoice of the business.
CREATE UNIQUE INDEX invoice_fiscal_uuid_idx ON invoice (tenant_id, fiscal_uuid) WHERE fiscal_uuid IS NOT NULL;

ALTER TABLE invoice ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice FORCE ROW LEVEL SECURITY;
CREATE POLICY invoice_isolation ON invoice
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- An invoice is never deleted: a stamped CFDI exists at the SAT whatever we do here.
REVOKE DELETE, TRUNCATE ON invoice FROM pos_app;
