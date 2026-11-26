-- E1-32: the global invoice of the sales that nobody asked to invoice (ADR 0080).
-- One CFDI to «Público en general» (RFC XAXX010101000) covers the sales of a closed period. Two tables:
--   global_invoice      -> the attempt and its state machine, like invoice (ADR 0050): pending, stamped, failed;
--   global_invoice_sale -> which sales the attempt covers. A partial unique index lets a sale be in at most one
--                          active global; a link is released (never deleted) when its global fails or, later,
--                          when it is cancelled (E1-33), so the sale can go into the replacement.
CREATE TABLE global_invoice
(
    tenant_id            uuid        NOT NULL DEFAULT current_tenant_id(),
    id                   uuid        NOT NULL,
    -- SAT periodicity code: 01 daily, 03 biweekly, 04 monthly (the ones the panel offers).
    periodicity          text        NOT NULL CHECK (periodicity IN ('01', '02', '03', '04', '05')),
    period_start         date        NOT NULL,
    period_end           date        NOT NULL,
    -- SAT month code (01-12, or 13-18 for bimonthly periods) and year sent in the global node.
    sat_months           text        NOT NULL CHECK (sat_months ~ '^(0[1-9]|1[0-8])$'),
    sat_year             integer     NOT NULL CHECK (sat_year BETWEEN 2022 AND 2200),
    status               text        NOT NULL CHECK (status IN ('pending', 'stamped', 'failed')),
    payment_form         text        NOT NULL CHECK (payment_form ~ '^[0-9]{2}$'),
    sale_count           integer     NOT NULL CHECK (sale_count >= 1),
    -- What the sales add up to, computed by the core, and what the provider stamped.
    expected_total_cents bigint      NOT NULL CHECK (expected_total_cents >= 1),
    total_cents          bigint CHECK (total_cents IS NULL OR total_cents >= 0),
    provider_invoice_id  text,
    fiscal_uuid          uuid,
    -- A short code that never carries fiscal data, as in invoice.
    error_code           text CHECK (error_code IS NULL OR error_code ~ '^[a-z_]{3,64}$'),
    provider_http_status integer,
    attempts             integer     NOT NULL DEFAULT 1 CHECK (attempts >= 1),
    attempt_started_at   timestamptz NOT NULL DEFAULT now(),
    requested_by         uuid,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now(),
    stamped_at           timestamptz,
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT global_invoice_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT global_invoice_period_in_order CHECK (period_start <= period_end),
    CONSTRAINT global_invoice_stamped_iff_fiscal_uuid
        CHECK ((status = 'stamped') = (fiscal_uuid IS NOT NULL AND provider_invoice_id IS NOT NULL))
);

-- One live global per period: a failed one stays as history and a new attempt may follow it.
CREATE UNIQUE INDEX global_invoice_one_per_period_idx ON global_invoice (tenant_id, periodicity, period_start)
    WHERE status IN ('pending', 'stamped');
CREATE UNIQUE INDEX global_invoice_fiscal_uuid_idx ON global_invoice (tenant_id, fiscal_uuid) WHERE fiscal_uuid IS NOT NULL;

CREATE TABLE global_invoice_sale
(
    tenant_id         uuid        NOT NULL DEFAULT current_tenant_id(),
    global_invoice_id uuid        NOT NULL,
    sale_id           uuid        NOT NULL,
    -- What the sale contributed (net of the returns the core had received), so a later credit note knows it.
    total_cents       bigint      NOT NULL CHECK (total_cents >= 1),
    released_at       timestamptz,
    PRIMARY KEY (tenant_id, global_invoice_id, sale_id),
    CONSTRAINT global_invoice_sale_global_fk FOREIGN KEY (tenant_id, global_invoice_id) REFERENCES global_invoice (tenant_id, id),
    CONSTRAINT global_invoice_sale_sale_fk FOREIGN KEY (tenant_id, sale_id) REFERENCES sale (tenant_id, id)
);

-- The rule of RF-036 in the database itself: a sale is in at most one active global.
CREATE UNIQUE INDEX global_invoice_sale_once_idx ON global_invoice_sale (tenant_id, sale_id) WHERE released_at IS NULL;

ALTER TABLE global_invoice ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_invoice FORCE ROW LEVEL SECURITY;
CREATE POLICY global_invoice_isolation ON global_invoice
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE global_invoice_sale ENABLE ROW LEVEL SECURITY;
ALTER TABLE global_invoice_sale FORCE ROW LEVEL SECURITY;
CREATE POLICY global_invoice_sale_isolation ON global_invoice_sale
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- A sale invoiced on its own after its global was stamped: the global must be cancelled with SAT motive 04 and
-- issued again without it (ADR 0080). The individual invoice records the global it overlaps.
ALTER TABLE invoice ADD COLUMN overlaps_global_invoice_id uuid;

-- Nothing here is ever deleted: a stamped CFDI exists at the SAT whatever we do.
REVOKE DELETE, TRUNCATE ON global_invoice FROM pos_app;
REVOKE DELETE, TRUNCATE ON global_invoice_sale FROM pos_app;
