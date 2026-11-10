package io.github.mauriciotorrez1.pos.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.github.mauriciotorrez1.pos.core.CoreApplication;
import io.github.mauriciotorrez1.pos.core.reporting.AuditEntry;
import io.github.mauriciotorrez1.pos.core.reporting.AuditLog;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import io.github.mauriciotorrez1.pos.tenant.TenantContext;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.IllegalTransactionStateException;
import org.springframework.transaction.support.TransactionTemplate;

/** The audit log keeps who, when, before and after, and nobody can edit it (RF-040, RNF-07). */
@SpringBootTest(classes = CoreApplication.class)
@Import(PostgresTestConfiguration.class)
class AuditLogTest {

    @Autowired
    private AuditLog auditLog;

    @Autowired
    private JdbcTemplate app;

    @Autowired
    @Qualifier("adminJdbc")
    private JdbcTemplate admin;

    @Autowired
    private TransactionTemplate transaction;

    private final UUID tenant = Uuid7.next();
    private final UUID actor = Uuid7.next();
    private final UUID product = Uuid7.next();

    @Test
    void anEntryKeepsTheUserTheTimeAndTheValuesBeforeAndAfter() {
        record(entry("price.changed", "{\"price\": 1250}", "{\"price\": 1400}"));

        var row = admin.queryForMap("SELECT * FROM audit_log WHERE entity_id = ?", product);
        assertThat(row.get("tenant_id")).isEqualTo(tenant);
        assertThat(row.get("actor_id")).isEqualTo(actor);
        assertThat(row.get("action")).isEqualTo("price.changed");
        assertThat(row.get("old_value").toString()).contains("1250");
        assertThat(row.get("new_value").toString()).contains("1400");
        assertThat(row.get("created_at")).isNotNull();
    }

    @Test
    void theEntryIsSavedOrLostTogetherWithTheChange() {
        assertThatThrownBy(() -> TenantContext.runAs(tenant, () -> transaction.executeWithoutResult(status -> {
            auditLog.record(entry("price.changed", null, "{\"price\": 1}"));
            throw new IllegalStateException("boom");
        }))).isInstanceOf(IllegalStateException.class);

        assertThat(admin.queryForObject("SELECT count(*) FROM audit_log WHERE entity_id = ?", Integer.class, product)).isZero();
    }

    @Test
    void anEntryCannotBeWrittenWithoutATransaction() {
        assertThatThrownBy(() -> auditLog.record(entry("price.changed", null, null)))
                .isInstanceOf(IllegalTransactionStateException.class);
    }

    @Test
    void aBusinessSeesOnlyItsOwnEntries() {
        record(entry("price.changed", null, "{\"price\": 1}"));
        UUID other = Uuid7.next();

        Integer own = TenantContext.callAs(tenant, () -> transaction.execute(
                status -> app.queryForObject("SELECT count(*) FROM audit_log WHERE entity_id = ?", Integer.class, product)));
        Integer seenByOther = TenantContext.callAs(other, () -> transaction.execute(
                status -> app.queryForObject("SELECT count(*) FROM audit_log WHERE entity_id = ?", Integer.class, product)));

        assertThat(own).isEqualTo(1);
        assertThat(seenByOther).isZero();
    }

    @Test
    void theApplicationRoleCannotUpdateDeleteOrTruncate() {
        record(entry("price.changed", null, "{\"price\": 1}"));

        for (String sql : new String[]{"UPDATE audit_log SET action = 'x.y.z'", "DELETE FROM audit_log", "TRUNCATE audit_log"}) {
            assertThatThrownBy(() -> TenantContext.runAs(tenant, () -> transaction.executeWithoutResult(
                    status -> app.execute(sql))))
                    .as(sql).isInstanceOf(DataAccessException.class)
                    .rootCause().hasMessageContaining("permission denied");
        }
    }

    @Test
    void evenTheOwnerOfTheTableCannotUpdateDeleteOrTruncate() {
        record(entry("price.changed", null, "{\"price\": 1}"));

        for (String sql : new String[]{"UPDATE audit_log SET action = 'x.y.z'", "DELETE FROM audit_log", "TRUNCATE audit_log"}) {
            assertThatThrownBy(() -> admin.execute(sql)).as(sql).isInstanceOf(DataAccessException.class)
                    .rootCause().hasMessageContaining("append-only");
        }
        assertThat(admin.queryForObject("SELECT count(*) FROM audit_log WHERE entity_id = ?", Integer.class, product)).isEqualTo(1);
    }

    private AuditEntry entry(String action, String before, String after) {
        return new AuditEntry(actor, action, "product", product, before, after);
    }

    private void record(AuditEntry entry) {
        TenantContext.runAs(tenant, () -> transaction.executeWithoutResult(status -> auditLog.record(entry)));
    }
}
