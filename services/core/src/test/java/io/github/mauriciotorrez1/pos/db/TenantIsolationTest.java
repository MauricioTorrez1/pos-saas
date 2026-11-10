package io.github.mauriciotorrez1.pos.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.mauriciotorrez1.pos.core.CoreApplication;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import io.github.mauriciotorrez1.pos.tenant.TenantContext;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/** Two businesses share one database; each must see only its own rows through the application role. */
@SpringBootTest(classes = CoreApplication.class)
@Import(PostgresTestConfiguration.class)
class TenantIsolationTest {

    private static final List<String> TABLES = List.of("tenant", "branch", "register", "app_user");

    @Autowired
    private JdbcTemplate app;

    @Autowired
    @Qualifier("adminJdbc")
    private JdbcTemplate admin;

    @Autowired
    private TransactionTemplate transaction;

    private UUID tenantA;
    private UUID tenantB;
    private UUID branchB;

    @BeforeEach
    void seedTwoBusinesses() {
        admin.execute("TRUNCATE app_user, register, branch, tenant CASCADE");
        tenantA = seed("A");
        tenantB = seed("B");
        branchB = admin.queryForObject("SELECT id FROM branch WHERE tenant_id = ?", UUID.class, tenantB);
    }

    @Test
    void aBusinessSeesOnlyItsOwnRowsInEveryTable() {
        for (String table : TABLES) {
            Integer visible = asTenant(tenantA, () -> app.queryForObject("SELECT count(*) FROM " + table, Integer.class));
            assertThat(visible).as(table).isEqualTo(1);
        }
        Integer ownTenantRows = asTenant(tenantA, () -> app.queryForObject(
                "SELECT count(*) FROM branch WHERE tenant_id = ?", Integer.class, tenantA));
        assertThat(ownTenantRows).isEqualTo(1);
    }

    @Test
    void aBusinessCannotReadARowOfAnotherByItsId() {
        Integer found = asTenant(tenantA, () -> app.queryForObject(
                "SELECT count(*) FROM branch WHERE id = ?", Integer.class, branchB));
        Integer foundByTenant = asTenant(tenantA, () -> app.queryForObject(
                "SELECT count(*) FROM branch WHERE tenant_id = ?", Integer.class, tenantB));

        assertThat(found).isZero();
        assertThat(foundByTenant).isZero();
    }

    @Test
    void aBusinessCannotChangeOrDeleteRowsOfAnother() {
        int updated = asTenant(tenantA, () -> app.update("UPDATE branch SET name = 'hacked' WHERE id = ?", branchB));
        int deleted = asTenant(tenantA, () -> app.update("DELETE FROM branch WHERE id = ?", branchB));
        int renamedTenant = asTenant(tenantA, () -> app.update("UPDATE tenant SET name = 'hacked' WHERE id = ?", tenantB));

        assertThat(updated).isZero();
        assertThat(deleted).isZero();
        assertThat(renamedTenant).isZero();
        assertThat(admin.queryForObject("SELECT name FROM branch WHERE id = ?", String.class, branchB))
                .isEqualTo("Main branch");
    }

    @Test
    void aBusinessCannotInsertRowsForAnother() {
        assertThatThrownBy(() -> asTenant(tenantA, () -> app.update(
                "INSERT INTO branch (id, tenant_id, code, name) VALUES (?, ?, 'EVIL', 'Planted')",
                Uuid7.next(), tenantB)))
                .isInstanceOf(DataAccessException.class)
                .rootCause().hasMessageContaining("row-level security");
    }

    @Test
    void aBusinessCannotMoveItsRowToAnother() {
        assertThatThrownBy(() -> asTenant(tenantA, () -> app.update(
                "UPDATE branch SET tenant_id = ? WHERE tenant_id = ?", tenantB, tenantA)))
                .isInstanceOf(DataAccessException.class)
                .rootCause().hasMessageContaining("row-level security");
    }

    @Test
    void aTransactionWithoutTenantSeesNothing() {
        for (String table : TABLES) {
            Integer visible = transaction.execute(status -> app.queryForObject("SELECT count(*) FROM " + table, Integer.class));
            assertThat(visible).as(table).isZero();
        }
    }

    @Test
    void aQueryOutsideAnyTransactionSeesNothing() {
        for (String table : TABLES) {
            assertThat(app.queryForObject("SELECT count(*) FROM " + table, Integer.class)).as(table).isZero();
        }
        assertThat(admin.queryForObject("SELECT count(*) FROM branch", Integer.class)).isEqualTo(2);
    }

    @Test
    void theTenantDoesNotLeakToTheNextUseOfTheSamePooledConnection() {
        asTenant(tenantA, () -> app.queryForObject("SELECT count(*) FROM branch", Integer.class));

        // The pool has one connection, so this query reuses the one that just served tenant A.
        Integer afterwards = app.queryForObject("SELECT count(*) FROM branch", Integer.class);
        String setting = app.queryForObject("SELECT coalesce(current_setting('app.tenant_id', true), '')", String.class);

        assertThat(afterwards).isZero();
        assertThat(setting).isEmpty();
    }

    @Test
    void aRolledBackTransactionDoesNotLeakTheTenantEither() {
        assertThatThrownBy(() -> asTenant(tenantA, () -> transaction.execute(status -> {
            app.queryForObject("SELECT count(*) FROM branch", Integer.class);
            throw new IllegalStateException("boom");
        }))).isInstanceOf(IllegalStateException.class);

        assertThat(app.queryForObject("SELECT count(*) FROM branch", Integer.class)).isZero();
    }

    @Test
    void theContextIsRestoredAfterANestedBlock() {
        TenantContext.runAs(tenantA, () -> {
            TenantContext.runAs(tenantB, () -> assertThat(TenantContext.current()).contains(tenantB));
            assertThat(TenantContext.current()).contains(tenantA);
        });
        assertThat(TenantContext.current()).isEmpty();
    }

    private <T> T asTenant(UUID tenant, java.util.function.Supplier<T> query) {
        return TenantContext.callAs(tenant, () -> transaction.execute(status -> query.get()));
    }

    private UUID seed(String name) {
        UUID tenant = Uuid7.next();
        UUID branch = Uuid7.next();
        admin.update("INSERT INTO tenant (id, name) VALUES (?, ?)", tenant, name);
        admin.update("INSERT INTO branch (id, tenant_id, code, name) VALUES (?, ?, 'MAIN', 'Main branch')", branch, tenant);
        admin.update("INSERT INTO register (id, tenant_id, branch_id, code, name) VALUES (?, ?, ?, 'T1', 'Register')",
                Uuid7.next(), tenant, branch);
        admin.update("INSERT INTO app_user (id, tenant_id, display_name, role) VALUES (?, ?, 'Owner', 'owner')",
                Uuid7.next(), tenant);
        return tenant;
    }
}
