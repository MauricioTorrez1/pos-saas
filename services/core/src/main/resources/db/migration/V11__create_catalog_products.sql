-- F0-16: products, codes and units of the catalog (ADR 0051).
-- Every table carries tenant_id and row-level security (ADR 0035). Ids are UUIDv7 made by the core (ADR 0034).
-- Prices, taxes and SAT keys are not here: they arrive with F0-17.

-- The text a search compares: lower case and without accents, so "Tornillo" finds "tornillo" and "clavo" finds
-- "Clavo galvanizado" and "camión" finds "camion". IMMUTABLE so a generated column and an index can use it.
CREATE FUNCTION catalog_search_key(value text) RETURNS text
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$
SELECT lower(translate(value, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunaeiouun'))
$$;

CREATE TABLE product
(
    tenant_id       uuid        NOT NULL DEFAULT current_tenant_id(),
    id              uuid        NOT NULL,
    name            text        NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 200),
    search_text     text GENERATED ALWAYS AS (catalog_search_key(name)) STORED,
    status          text        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    -- The base unit of ADR 0011. It never changes after creation: sale lines and the stock ledger count in it.
    unit            text        NOT NULL CHECK (unit IN ('piece', 'meter', 'kilogram', 'liter')),
    -- Logical delete: the row stays so sales keep their product and the registers learn of the removal.
    deleted_at      timestamptz,
    -- The key the caller sent when creating the product; repeating the request returns the same product.
    idempotency_key uuid        NOT NULL,
    -- Position of the last change of the product in the change feed of its business (see catalog_change_counter).
    change_seq      bigint      NOT NULL CHECK (change_seq >= 1),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT product_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT product_idempotency_key_per_tenant UNIQUE (tenant_id, idempotency_key),
    -- The pull of E1-18 reads "everything after cursor N"; unique so two changes never share a position.
    CONSTRAINT product_change_seq_per_tenant UNIQUE (tenant_id, change_seq)
);

CREATE INDEX product_search_idx ON product (tenant_id, search_text, id) WHERE deleted_at IS NULL;

-- A barcode or alternate code. The primary key is what makes a code point to one product per business.
CREATE TABLE product_code
(
    tenant_id  uuid        NOT NULL DEFAULT current_tenant_id(),
    code       text        NOT NULL CHECK (code ~ '^\S{1,64}$'),
    product_id uuid        NOT NULL,
    kind       text        NOT NULL CHECK (kind IN ('barcode', 'alternate')),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, code),
    CONSTRAINT product_code_product_fk FOREIGN KEY (tenant_id, product_id) REFERENCES product (tenant_id, id)
);

CREATE INDEX product_code_product_idx ON product_code (tenant_id, product_id);

-- A way to buy or count the product in bulk: a roll of 100 m of a product whose base unit is the meter.
CREATE TABLE product_presentation
(
    tenant_id           uuid   NOT NULL DEFAULT current_tenant_id(),
    id                  uuid   NOT NULL,
    product_id          uuid   NOT NULL,
    name                text   NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 50),
    -- Thousandths of the base unit in one presentation: a 100 m roll is 100000.
    base_quantity_milli bigint NOT NULL CHECK (base_quantity_milli >= 1),
    PRIMARY KEY (tenant_id, id),
    CONSTRAINT product_presentation_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT product_presentation_name_per_product UNIQUE (tenant_id, product_id, name),
    CONSTRAINT product_presentation_product_fk FOREIGN KEY (tenant_id, product_id) REFERENCES product (tenant_id, id)
);

-- The counter of the change feed. One row per business; taking the next number locks the row until the
-- transaction ends, so numbers are handed out and committed in the same order and a reader that remembers
-- "I have up to N" can never skip a change that commits late.
CREATE TABLE catalog_change_counter
(
    tenant_id uuid   NOT NULL DEFAULT current_tenant_id(),
    last_seq  bigint NOT NULL CHECK (last_seq >= 0),
    PRIMARY KEY (tenant_id)
);

DO
$$
    DECLARE
        catalog_table text;
    BEGIN
        FOREACH catalog_table IN ARRAY ARRAY ['product', 'product_code', 'product_presentation', 'catalog_change_counter']
            LOOP
                EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', catalog_table);
                EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', catalog_table);
                EXECUTE format('CREATE POLICY %I ON %I USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id())',
                               catalog_table || '_isolation', catalog_table);
            END LOOP;
    END
$$;

-- A product is never removed, only marked: the registers and the sales keep pointing at it.
REVOKE DELETE, TRUNCATE ON product FROM pos_app;
