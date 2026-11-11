-- F0-15: register enrollment and PINs on the server (ADR 0043). Every table is protected by row-level
-- security with the policy of ADR 0035; the coverage test of CI fails if one is missing.

-- The PIN of a user: only the Argon2id hash is stored, never the PIN. The lock is stored too, so
-- restarting the core does not clear it (RF-009).
CREATE TABLE user_pin
(
    user_id         uuid PRIMARY KEY,
    tenant_id       uuid        NOT NULL DEFAULT current_tenant_id(),
    -- PHC string: it carries the algorithm, its parameters and the salt, so parameters can be raised later.
    pin_hash        text        NOT NULL CHECK (pin_hash LIKE '$argon2id$%'),
    -- Consecutive wrong PINs. It goes back to 0 on a right PIN and when the lock starts.
    failed_attempts integer     NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    -- While in the future, the PIN is not even checked.
    locked_until    timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT user_pin_user_fk FOREIGN KEY (tenant_id, user_id) REFERENCES app_user (tenant_id, id)
);

ALTER TABLE user_pin ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_pin FORCE ROW LEVEL SECURITY;
CREATE POLICY user_pin_isolation ON user_pin
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- A one-time code that lets a physical register join a business. Only its SHA-256 is stored: the code
-- has 80 random bits, so a fast hash is enough, and it is shown to the owner once.
CREATE TABLE enrollment_code
(
    id            uuid PRIMARY KEY     DEFAULT uuid_v7(),
    tenant_id     uuid        NOT NULL DEFAULT current_tenant_id(),
    branch_id     uuid        NOT NULL,
    -- The register that will be created when the code is redeemed (same rules as register.code and name).
    register_code text        NOT NULL CHECK (register_code ~ '^[A-Z0-9]{1,10}$'),
    register_name text        NOT NULL CHECK (length(btrim(register_name)) > 0),
    code_hash     text        NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
    created_by    uuid        NOT NULL,
    expires_at    timestamptz NOT NULL,
    redeemed_at   timestamptz,
    register_id   uuid,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT enrollment_code_id_is_uuid_v7 CHECK (is_uuid_v7(id)),
    CONSTRAINT enrollment_code_hash_per_tenant UNIQUE (tenant_id, code_hash),
    CONSTRAINT enrollment_code_branch_fk FOREIGN KEY (tenant_id, branch_id) REFERENCES branch (tenant_id, id),
    CONSTRAINT enrollment_code_creator_fk FOREIGN KEY (tenant_id, created_by) REFERENCES app_user (tenant_id, id),
    CONSTRAINT enrollment_code_register_fk FOREIGN KEY (tenant_id, register_id) REFERENCES register (tenant_id, id),
    -- A register is only ever tied to a code that was spent; the code is spent first, then the register is created.
    CONSTRAINT enrollment_code_register_needs_redemption CHECK (register_id IS NULL OR redeemed_at IS NOT NULL)
);

ALTER TABLE enrollment_code ENABLE ROW LEVEL SECURITY;
ALTER TABLE enrollment_code FORCE ROW LEVEL SECURITY;
CREATE POLICY enrollment_code_isolation ON enrollment_code
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

-- The credential of an enrolled register. Only the SHA-256 of its random token is stored.
CREATE TABLE register_device
(
    register_id uuid PRIMARY KEY,
    tenant_id   uuid        NOT NULL DEFAULT current_tenant_id(),
    token_hash  text        NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    enrolled_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT register_device_register_fk FOREIGN KEY (tenant_id, register_id) REFERENCES register (tenant_id, id),
    CONSTRAINT register_device_token_unique UNIQUE (token_hash)
);

ALTER TABLE register_device ENABLE ROW LEVEL SECURITY;
ALTER TABLE register_device FORCE ROW LEVEL SECURITY;
CREATE POLICY register_device_isolation ON register_device
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
