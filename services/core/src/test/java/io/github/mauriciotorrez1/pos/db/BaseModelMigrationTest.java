package io.github.mauriciotorrez1.pos.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.mauriciotorrez1.pos.core.CoreApplication;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/** Boots the application against an empty PostgreSQL and checks what Flyway left behind. */
@SpringBootTest(classes = CoreApplication.class)
@Import(PostgresTestConfiguration.class)
class BaseModelMigrationTest {

    /** Seeds and queries as the migration role: the table owner's data setup must not depend on RLS. */
    @Autowired
    @Qualifier("adminJdbc")
    private JdbcTemplate jdbc;

    @BeforeEach
    void cleanData() {
        jdbc.execute("TRUNCATE app_user, register, branch, tenant CASCADE");
    }

    @Test
    void anEmptyDatabaseIsLeftUpToDateWithoutManualSteps() {
        List<String> tables = jdbc.queryForList("""
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_name <> 'flyway_schema_history'
                ORDER BY table_name
                """, String.class);
        String latestState = jdbc.queryForObject("""
                SELECT success::text FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 1
                """, String.class);
<<<<<<< HEAD
        assertThat(tables).containsExactly("app_user", "audit_log", "branch", "cash_cut", "cash_movement", "cash_session", "catalog_change_counter",
                "cut_report_delivery", "enrollment_code", "event_publication", "product", "product_code", "product_presentation", "product_price_change", "register", "register_device",
                "sale", "sale_line", "sale_payment", "sale_return", "sale_return_line", "sale_return_refund", "stock_movement", "stock_receipt",
                "sync_operation", "tenant", "user_pin");
        assertThat(latestState).isEqualTo("true");
    }

    @Test
    void everyTableOfTheBusinessCarriesItsTenant() {
        List<String> withoutTenant = jdbc.queryForList("""
                SELECT table_name FROM information_schema.tables t
                WHERE table_schema = 'public' AND table_name NOT IN ('flyway_schema_history', 'event_publication', 'tenant')
                  AND NOT EXISTS (SELECT 1 FROM information_schema.columns c
                                  WHERE c.table_schema = 'public' AND c.table_name = t.table_name
                                    AND c.column_name = 'tenant_id' AND c.is_nullable = 'NO')
                """, String.class);

        assertThat(withoutTenant).isEmpty();
    }

    @Test
    void theSqlGeneratorProducesVersion7Ids() {
        UUID first = jdbc.queryForObject("SELECT uuid_v7()", UUID.class);
        UUID second = jdbc.queryForObject("SELECT uuid_v7()", UUID.class);

        assertThat(first.version()).isEqualTo(7);
        assertThat(first.variant()).isEqualTo(2);
        assertThat(Math.abs(Uuid7.timestampMillis(first) - System.currentTimeMillis())).isLessThan(60_000);
        assertThat(second).isNotEqualTo(first);
    }

    @Test
    void theSqlCheckAgreesWithTheJavaGenerator() {
        Boolean javaId = jdbc.queryForObject("SELECT is_uuid_v7(?)", Boolean.class, Uuid7.next());
        Boolean randomId = jdbc.queryForObject("SELECT is_uuid_v7(?)", Boolean.class, UUID.randomUUID());

        assertThat(javaId).isTrue();
        assertThat(randomId).isFalse();
    }

    @Test
    void aBusinessCanHaveBranchRegisterAndUsers() {
        UUID tenant = insertTenant("Tlapaleria de prueba");
        UUID branch = insertBranch(tenant, "MAIN");
        insertRegister(tenant, branch, "T1");
        jdbc.update("INSERT INTO app_user (id, tenant_id, display_name, role) VALUES (?, ?, 'Owner', 'owner')",
                Uuid7.next(), tenant);

        Integer registers = jdbc.queryForObject("SELECT count(*) FROM register WHERE tenant_id = ?",
                Integer.class, tenant);
        UUID generatedId = jdbc.queryForObject(
                "INSERT INTO tenant (name) VALUES ('Default id') RETURNING id", UUID.class);

        assertThat(registers).isEqualTo(1);
        assertThat(generatedId.version()).isEqualTo(7);
    }

    @Test
    void refusesAnIdThatIsNotUuidV7() {
        assertThatThrownBy(() -> jdbc.update("INSERT INTO tenant (id, name) VALUES (?, 'Random')", UUID.randomUUID()))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("tenant_id_is_uuid_v7");
    }

    @Test
    void aRegisterCannotPointAtABranchOfAnotherBusiness() {
        UUID tenantA = insertTenant("A");
        UUID tenantB = insertTenant("B");
        UUID branchOfB = insertBranch(tenantB, "MAIN");

        assertThatThrownBy(() -> insertRegister(tenantA, branchOfB, "T1"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("register_branch_fk");
    }

    @Test
    void registerCodesAreUniquePerBusinessButNotAcrossBusinesses() {
        UUID tenantA = insertTenant("A");
        UUID tenantB = insertTenant("B");
        UUID branchA = insertBranch(tenantA, "MAIN");
        UUID branchB = insertBranch(tenantB, "MAIN");
        insertRegister(tenantA, branchA, "T1");

        insertRegister(tenantB, branchB, "T1");

        assertThatThrownBy(() -> insertRegister(tenantA, branchA, "T1"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("register_code_per_tenant");
    }

    @Test
    void refusesAnUnknownRole() {
        UUID tenant = insertTenant("A");

        assertThatThrownBy(() -> jdbc.update(
                "INSERT INTO app_user (id, tenant_id, display_name, role) VALUES (?, ?, 'Eve', 'admin')",
                Uuid7.next(), tenant))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    private UUID insertTenant(String name) {
        UUID id = Uuid7.next();
        jdbc.update("INSERT INTO tenant (id, name) VALUES (?, ?)", id, name);
        return id;
    }

    private UUID insertBranch(UUID tenant, String code) {
        UUID id = Uuid7.next();
        jdbc.update("INSERT INTO branch (id, tenant_id, code, name) VALUES (?, ?, ?, 'Main branch')",
                id, tenant, code);
        return id;
    }

    private UUID insertRegister(UUID tenant, UUID branch, String code) {
        UUID id = Uuid7.next();
        jdbc.update("INSERT INTO register (id, tenant_id, branch_id, code, name) VALUES (?, ?, ?, ?, 'Register')",
                id, tenant, branch, code);
        return id;
    }
}
