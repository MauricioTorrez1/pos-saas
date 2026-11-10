package io.github.mauriciotorrez1.pos.db;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.mauriciotorrez1.pos.core.CoreApplication;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Walks every table of the schema, so a new table without row-level security breaks CI (ADR 0004).
 * Nothing here is a list of table names: the catalog is the source of truth.
 */
@SpringBootTest(classes = CoreApplication.class)
@Import(PostgresTestConfiguration.class)
class RowLevelSecurityCoverageTest {

    private static final String BUSINESS_TABLES = """
            SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname NOT IN ('flyway_schema_history', 'event_publication')
            """;

    @Autowired
    @Qualifier("adminJdbc")
    private JdbcTemplate admin;

    @Test
    void thereAreBusinessTablesToCheck() {
        assertThat(admin.queryForList(BUSINESS_TABLES, String.class)).contains("tenant", "branch", "register", "app_user");
    }

    @Test
    void everyTableEnablesAndForcesRowLevelSecurity() {
        List<String> unprotected = admin.queryForList("""
                SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname NOT IN ('flyway_schema_history', 'event_publication')
                  AND NOT (c.relrowsecurity AND c.relforcerowsecurity)
                ORDER BY c.relname
                """, String.class);

        assertThat(unprotected).as("tables without ENABLE and FORCE ROW LEVEL SECURITY").isEmpty();
    }

    @Test
    void everyTableHasAPolicyThatUsesTheTenantOfTheTransaction() {
        List<String> withoutPolicy = admin.queryForList("""
                SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname NOT IN ('flyway_schema_history', 'event_publication')
                  AND NOT EXISTS (SELECT 1 FROM pg_policies p
                                  WHERE p.schemaname = 'public' AND p.tablename = c.relname
                                    AND p.qual LIKE '%current_tenant_id()%'
                                    AND p.with_check LIKE '%current_tenant_id()%')
                ORDER BY c.relname
                """, String.class);

        assertThat(withoutPolicy).as("tables without a policy on current_tenant_id()").isEmpty();
    }

    @Test
    void everyBusinessTableCarriesItsTenant() {
        List<String> withoutTenant = admin.queryForList("""
                SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
                  AND c.relname NOT IN ('flyway_schema_history', 'event_publication', 'tenant')
                  AND NOT EXISTS (SELECT 1 FROM pg_attribute a
                                  WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND a.attnotnull)
                """, String.class);

        assertThat(withoutTenant).isEmpty();
    }

    @Test
    void theApplicationRoleCannotBypassRowLevelSecurity() {
        List<java.util.Map<String, Object>> role = admin.queryForList("""
                SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'pos_app'
                """);

        assertThat(role).hasSize(1);
        assertThat(role.get(0)).containsEntry("rolsuper", false).containsEntry("rolbypassrls", false);
    }

    @Test
    void theApplicationRoleOwnsNoTable() {
        List<String> owned = admin.queryForList("""
                SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = 'pos_app'
                """, String.class);

        assertThat(owned).isEmpty();
    }
}
