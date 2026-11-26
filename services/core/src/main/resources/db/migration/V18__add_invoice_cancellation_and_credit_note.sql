-- E1-33: cancelling a CFDI and the credit note of a return (ADR 0081).
-- Nothing is deleted: a cancelled CFDI keeps its row with the cancellation state, a replaced invoice is marked
-- superseded, and the sales of a cancelled global are released so a new global may take them.

-- invoice -------------------------------------------------------------------------------------------------------

-- The provider receiver, so a credit note can go to the same customer without asking for the fiscal data again.
ALTER TABLE invoice ADD COLUMN provider_customer_id text;
-- A replacement invoice of the same sale (SAT relation 04), stamped before cancelling the original with motive 01.
ALTER TABLE invoice ADD COLUMN replaces_invoice_id uuid;
-- Set when the invoice stops covering its sale: its cancellation was accepted.
ALTER TABLE invoice ADD COLUMN superseded_at timestamptz;

-- One live invoice per sale, besides the replacement of one being corrected. The service checks the rest under the
-- invoicing lock (ADR 0080); the index keeps the plain case safe even from a bug.
ALTER TABLE invoice DROP CONSTRAINT invoice_one_per_sale;
CREATE UNIQUE INDEX invoice_one_per_sale ON invoice (tenant_id, sale_id)
    WHERE replaces_invoice_id IS NULL AND superseded_at IS NULL;
CREATE UNIQUE INDEX invoice_one_replacement_idx ON invoice (tenant_id, replaces_invoice_id) WHERE replaces_invoice_id IS NOT NULL;
CREATE INDEX invoice_sale_idx ON invoice (tenant_id, sale_id);

-- The cancellation, for invoice and global_invoice alike:
--   requested -> we asked the provider and the outcome is not known yet,
--   pending   -> the SAT waits for the receiver to accept it,
--   accepted  -> cancelled at the SAT,
--   rejected  -> the receiver refused it; the CFDI stays valid,
--   failed    -> the provider refused the request; nothing changed and it may be asked again.
ALTER TABLE invoice
    ADD COLUMN cancellation_status          text CHECK (cancellation_status IN ('requested', 'pending', 'accepted', 'rejected', 'failed')),
    ADD COLUMN cancellation_motive          text CHECK (cancellation_motive IN ('01', '02', '03', '04')),
    ADD COLUMN cancellation_substitute_uuid uuid,
    ADD COLUMN cancellation_error_code      text CHECK (cancellation_error_code IS NULL OR cancellation_error_code ~ '^[a-z_]{3,64}$'),
    ADD COLUMN cancellation_requested_by    uuid,
    ADD COLUMN cancellation_requested_at    timestamptz,
    ADD COLUMN cancellation_updated_at      timestamptz,
    ADD CONSTRAINT invoice_motive_01_has_substitute
        CHECK (cancellation_motive IS DISTINCT FROM '01' OR cancellation_substitute_uuid IS NOT NULL);

-- global_invoice --------------------------------------------------------------------------------------------------

ALTER TABLE global_invoice
    ADD COLUMN cancellation_status          text CHECK (cancellation_status IN ('requested', 'pending', 'accepted', 'rejected', 'failed')),
    ADD COLUMN cancellation_motive          text CHECK (cancellation_motive IN ('01', '02', '03', '04')),
    ADD COLUMN cancellation_substitute_uuid uuid,
    ADD COLUMN cancellation_error_code      text CHECK (cancellation_error_code IS NULL OR cancellation_error_code ~ '^[a-z_]{3,64}$'),
    ADD COLUMN cancellation_requested_by    uuid,
    ADD COLUMN cancellation_requested_at    timestamptz,
    ADD COLUMN cancellation_updated_at      timestamptz;

-- A cancelled global frees its period, so the corrected one can be issued.
DROP INDEX global_invoice_one_per_period_idx;
CREATE UNIQUE INDEX global_invoice_one_per_period_idx ON global_invoice (tenant_id, periodicity, period_start)
    WHERE status IN ('pending', 'stamped') AND cancellation_status IS DISTINCT FROM 'accepted';

-- credit_note -----------------------------------------------------------------------------------------------------

-- One CFDI of type E per return of an invoiced sale, related (SAT relation 01) to the invoice or the global that
-- covered the sale. Same state machine as invoice.
CREATE TABLE credit_note
(
    tenant_id            uuid        NOT NULL DEFAULT current_tenant_id(),
    id                   uuid        NOT NULL,
    return_id            uuid        NOT NULL,
    invoice_id           uuid,
    global_invoice_id    uuid,
    related_fiscal_uuid  uuid        NOT NULL,
    status               text        NOT NULL CHECK (status IN ('pending', 'stamped', 'failed')),
    payment_form         text        NOT NULL CHECK (payment_form ~ '^[0-9]{2}$'),
    expected_total_cents bigint      NOT NULL CHECK (expected_total_cents >= 1),
    total_cents          bigint CHECK (total_cents IS NULL OR total_cents >= 0),
    provider_invoice_id  text,
    fiscal_uuid          uuid,
    error_code           text CHECK (error_code IS NULL OR error_code ~ '^[a-z_]{3,64}$'),
    provider_http_status integer,
    attempts             integer     NOT NULL DEFAULT 1 CHECK (attempts >= 1),
    attempt_started_at   timestamptz NOT NULL DEFAULT now(),
    requested_by         uuid,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    stamped_at           timestamptz,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT credit_note_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT credit_note_one_per_return UNIQUE (tenant_id, return_id),
    CONSTRAINT credit_note_return_fk FOREIGN KEY (tenant_id, return_id) REFERENCES sale_return (tenant_id, id),
    CONSTRAINT credit_note_invoice_fk FOREIGN KEY (tenant_id, invoice_id) REFERENCES invoice (tenant_id, id),
    CONSTRAINT credit_note_global_fk FOREIGN KEY (tenant_id, global_invoice_id) REFERENCES global_invoice (tenant_id, id),
    CONSTRAINT credit_note_relates_to_one CHECK ((invoice_id IS NULL) <> (global_invoice_id IS NULL)),
    CONSTRAINT credit_note_stamped_iff_fiscal_uuid
        CHECK ((status = 'stamped') = (fiscal_uuid IS NOT NULL AND provider_invoice_id IS NOT NULL))
);

CREATE UNIQUE INDEX credit_note_fiscal_uuid_idx ON credit_note (tenant_id, fiscal_uuid) WHERE fiscal_uuid IS NOT NULL;

ALTER TABLE credit_note ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_note FORCE ROW LEVEL SECURITY;
CREATE POLICY credit_note_isolation ON credit_note
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

REVOKE DELETE, TRUNCATE ON credit_note FROM pos_app;
