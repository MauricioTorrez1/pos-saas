-- F0-09: row-level security (ADR 0004, ADR 0035).
-- Every business table is filtered by the tenant the core pins with SET LOCAL app.tenant_id at the
-- start of each transaction. Without that value no row is visible: the failure is safe.

-- The tenant of the current transaction, or NULL when none was pinned. nullif() covers the empty
-- string that PostgreSQL leaves in the setting after a transaction that used SET LOCAL ends.
CREATE FUNCTION current_tenant_id() RETURNS uuid
    LANGUAGE sql STABLE PARALLEL SAFE AS
$$
SELECT nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

-- The application role: no superuser, no BYPASSRLS, not the owner of any table. The password is
-- never stored in a migration; the deployment sets it with ALTER ROLE pos_app PASSWORD '...'.
DO
$$
    BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pos_app') THEN
            CREATE ROLE pos_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
        END IF;
    END
$$;

GRANT USAGE ON SCHEMA public TO pos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON tenant, branch, register, app_user TO pos_app;
-- Later tables created by the migration role are usable by the application. A table without a
-- policy is caught by the isolation test in CI, so this default never ships unprotected data.
ALTER DEFAULT PRIVILEGES GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO pos_app;

ALTER TABLE tenant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant
    USING (id = current_tenant_id())
    WITH CHECK (id = current_tenant_id());

ALTER TABLE branch ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch FORCE ROW LEVEL SECURITY;
CREATE POLICY branch_isolation ON branch
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE register ENABLE ROW LEVEL SECURITY;
ALTER TABLE register FORCE ROW LEVEL SECURITY;
CREATE POLICY register_isolation ON register
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());

ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user FORCE ROW LEVEL SECURITY;
CREATE POLICY app_user_isolation ON app_user
    USING (tenant_id = current_tenant_id())
    WITH CHECK (tenant_id = current_tenant_id());
