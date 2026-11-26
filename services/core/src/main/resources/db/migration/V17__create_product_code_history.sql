-- E1-62: a product that is given up (inactive) or deleted frees its codes, so a new product can use them (ADR 0080).
-- The codes move to an append-only history that still tells which products ever had a code. A code may be released,
-- restored and released again, so the moment is part of the key. The unique key of product_code now only holds the codes
-- of live, active products: uniqueness among active products without a partial index.
CREATE TABLE product_code_history
(
    tenant_id   uuid        NOT NULL DEFAULT current_tenant_id(),
    code        text        NOT NULL CHECK (code ~ '^\S{1,64}$'),
    product_id  uuid        NOT NULL,
    kind        text        NOT NULL CHECK (kind IN ('barcode', 'alternate')),
    released_at timestamptz NOT NULL DEFAULT now(),
    -- Set once, when the same product gets the code back.
    restored_at timestamptz,
    PRIMARY KEY (tenant_id, code, released_at, product_id),
    CONSTRAINT product_code_history_product_fk FOREIGN KEY (tenant_id, product_id) REFERENCES product (tenant_id, id)
);

CREATE INDEX product_code_history_product_idx ON product_code_history (tenant_id, product_id);

ALTER TABLE product_code_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_code_history FORCE ROW LEVEL SECURITY;
CREATE POLICY product_code_history_isolation ON product_code_history
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- What a released code says never changes, it is restored only once, and the history is never deleted.
CREATE FUNCTION product_code_history_guard() RETURNS trigger
    LANGUAGE plpgsql AS
$$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'the history of the codes is never deleted';
    END IF;
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.code IS DISTINCT FROM OLD.code
        OR NEW.product_id IS DISTINCT FROM OLD.product_id OR NEW.kind IS DISTINCT FROM OLD.kind
        OR NEW.released_at IS DISTINCT FROM OLD.released_at THEN
        RAISE EXCEPTION 'a released code never changes what it says';
    END IF;
    IF OLD.restored_at IS NOT NULL THEN
        RAISE EXCEPTION 'a released code is restored only once';
    END IF;
    RETURN NEW;
END
$$;

CREATE TRIGGER product_code_history_guard
    BEFORE UPDATE OR DELETE ON product_code_history
    FOR EACH ROW EXECUTE FUNCTION product_code_history_guard();

REVOKE DELETE, TRUNCATE ON product_code_history FROM pos_app;

-- The products that were already inactive or deleted release their codes now. Row-level security is forced on these
-- tables, so the owner of the tables would only see the rows of a pinned business: it is lifted for the move, which spans
-- every business, and put back right after, in the same transaction.
ALTER TABLE product NO FORCE ROW LEVEL SECURITY;
ALTER TABLE product_code NO FORCE ROW LEVEL SECURITY;
ALTER TABLE product_code_history NO FORCE ROW LEVEL SECURITY;

INSERT INTO product_code_history (tenant_id, code, product_id, kind, released_at)
SELECT c.tenant_id, c.code, c.product_id, c.kind, coalesce(p.deleted_at, p.updated_at)
FROM product_code c
         JOIN product p ON p.tenant_id = c.tenant_id AND p.id = c.product_id
WHERE p.status = 'inactive' OR p.deleted_at IS NOT NULL;

DELETE FROM product_code c
    USING product p
WHERE p.tenant_id = c.tenant_id AND p.id = c.product_id AND (p.status = 'inactive' OR p.deleted_at IS NOT NULL);

ALTER TABLE product FORCE ROW LEVEL SECURITY;
ALTER TABLE product_code FORCE ROW LEVEL SECURITY;
ALTER TABLE product_code_history FORCE ROW LEVEL SECURITY;
