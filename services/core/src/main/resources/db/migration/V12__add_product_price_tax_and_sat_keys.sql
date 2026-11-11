-- F0-17: price, tax and SAT keys of a product (ADR 0056).
-- The price is VAT included, in ten-thousandths of a peso (ADR 0011, ADR 0023). A product made without a price
-- starts at 0 and the owner sets it. The tax rates the catalog offers are 16%, 8% (border zone), 0% and exempt.
ALTER TABLE product
    ADD COLUMN unit_price_e4    bigint  NOT NULL DEFAULT 0 CHECK (unit_price_e4 BETWEEN 0 AND 9007199254740991),
    ADD COLUMN tax_factor       text    NOT NULL DEFAULT 'rate' CHECK (tax_factor IN ('rate', 'exempt')),
    ADD COLUMN tax_rate_bp      integer NOT NULL DEFAULT 1600 CHECK (tax_rate_bp IN (0, 800, 1600)),
    -- c_ClaveProdServ: 8 digits. c_ClaveUnidad: 2 or 3 letters or digits. Both are checked against a reviewable
    -- file in the core as well; the database only guards the format. Without both keys the product cannot be invoiced.
    ADD COLUMN sat_product_key  text CHECK (sat_product_key ~ '^[0-9]{8}$'),
    ADD COLUMN sat_unit_key     text CHECK (sat_unit_key ~ '^[A-Z0-9]{2,3}$'),
    ADD CONSTRAINT product_exempt_has_no_rate CHECK (tax_factor = 'rate' OR tax_rate_bp = 0);

CREATE INDEX product_fiscal_pending_idx ON product (tenant_id, search_text, id)
    WHERE deleted_at IS NULL AND (sat_product_key IS NULL OR sat_unit_key IS NULL);

-- Every price a product has had, only added to: the price charged yesterday stays true after today's change.
CREATE TABLE product_price_history
(
    tenant_id              uuid        NOT NULL DEFAULT current_tenant_id(),
    id                     uuid        NOT NULL,
    product_id             uuid        NOT NULL,
    -- Null for the price a product is created with.
    previous_unit_price_e4 bigint CHECK (previous_unit_price_e4 IS NULL OR previous_unit_price_e4 >= 0),
    new_unit_price_e4      bigint      NOT NULL CHECK (new_unit_price_e4 >= 0),
    changed_by             uuid,
    -- Where the change came from: the creation of the product, the panel, or a register (E1-40).
    source                 text        NOT NULL CHECK (source IN ('created', 'panel', 'register')),
    changed_at             timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT product_price_history_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT product_price_history_product_fk FOREIGN KEY (tenant_id, product_id) REFERENCES product (tenant_id, id)
);

CREATE INDEX product_price_history_product_idx ON product_price_history (tenant_id, product_id, changed_at DESC, id DESC);

ALTER TABLE product_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_price_history FORCE ROW LEVEL SECURITY;
CREATE POLICY product_price_history_isolation ON product_price_history
    USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
CREATE TRIGGER product_price_history_append_only
    BEFORE UPDATE OR DELETE ON product_price_history
    FOR EACH ROW EXECUTE FUNCTION reject_modification();
REVOKE UPDATE, DELETE, TRUNCATE ON product_price_history FROM pos_app;

-- The change feed of E1-18 (sync_change) replaces the counter F0-16 prepared: product changes are published there.
ALTER TABLE product DROP COLUMN change_seq;
DROP TABLE catalog_change_counter;
