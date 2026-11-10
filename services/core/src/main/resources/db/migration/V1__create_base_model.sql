-- F0-08: base model of the core. Every id is a UUIDv7 (ADR 0034).
-- PostgreSQL 16 has no uuidv7(), so the core generates ids itself; these helpers guard the tables
-- and serve as a fallback default.

-- A UUIDv7 is a 48-bit Unix time in milliseconds followed by random bits, with version nibble 7.
CREATE FUNCTION uuid_v7() RETURNS uuid
    LANGUAGE sql VOLATILE PARALLEL SAFE AS
$$
SELECT encode(
               set_bit(
                       set_bit(
                               overlay(uuid_send(gen_random_uuid())
                                       PLACING substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
                                       FROM 1 FOR 6),
                               52, 1),
                       53, 1),
               'hex')::uuid
$$;

CREATE FUNCTION is_uuid_v7(value uuid) RETURNS boolean
    LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
$$
SELECT get_byte(uuid_send(value), 6) >> 4 = 7
$$;

-- A business that rents the system. It is the root of the isolation: ADR 0004 protects it with a policy on id.
CREATE TABLE tenant
(
    id         uuid PRIMARY KEY     DEFAULT uuid_v7(),
    name       text        NOT NULL CHECK (length(btrim(name)) > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tenant_id_is_uuid_v7 CHECK (is_uuid_v7(id))
);

CREATE TABLE branch
(
    id         uuid PRIMARY KEY     DEFAULT uuid_v7(),
    tenant_id  uuid        NOT NULL REFERENCES tenant (id),
    code       text        NOT NULL CHECK (code ~ '^[A-Z0-9]{1,10}$'),
    name       text        NOT NULL CHECK (length(btrim(name)) > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT branch_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT branch_code_per_tenant UNIQUE (tenant_id, code),
    -- Lets children point at (tenant_id, id), so a child can never mix two businesses.
    CONSTRAINT branch_tenant_id_unique UNIQUE (tenant_id, id)
);

-- A register exists even when the business has only one: sales, folios and sync cursors are per register.
CREATE TABLE register
(
    id         uuid PRIMARY KEY     DEFAULT uuid_v7(),
    tenant_id  uuid        NOT NULL,
    branch_id  uuid        NOT NULL,
    code       text        NOT NULL CHECK (code ~ '^[A-Z0-9]{1,10}$'),
    name       text        NOT NULL CHECK (length(btrim(name)) > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT register_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT register_branch_fk FOREIGN KEY (tenant_id, branch_id) REFERENCES branch (tenant_id, id),
    -- The code prefixes the folio, so it must be unique across the business.
    CONSTRAINT register_code_per_tenant UNIQUE (tenant_id, code),
    CONSTRAINT register_tenant_id_unique UNIQUE (tenant_id, id)
);

CREATE INDEX register_branch_idx ON register (tenant_id, branch_id);

CREATE TABLE app_user
(
    id               uuid PRIMARY KEY     DEFAULT uuid_v7(),
    tenant_id        uuid        NOT NULL REFERENCES tenant (id),
    display_name     text        NOT NULL CHECK (length(btrim(display_name)) > 0),
    role             text        NOT NULL CHECK (role IN ('owner', 'manager', 'cashier')),
    -- The subject claim of the Keycloak token (ADR 0006); empty while the user only has a local PIN.
    keycloak_subject text,
    active           boolean     NOT NULL DEFAULT true,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_user_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT app_user_keycloak_subject_unique UNIQUE (keycloak_subject),
    CONSTRAINT app_user_tenant_id_unique UNIQUE (tenant_id, id)
);

CREATE INDEX app_user_tenant_idx ON app_user (tenant_id);
