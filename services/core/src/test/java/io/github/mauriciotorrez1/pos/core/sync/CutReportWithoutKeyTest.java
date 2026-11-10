package io.github.mauriciotorrez1.pos.core.sync;

import static io.github.mauriciotorrez1.pos.core.sync.SyncFixtures.batch;
import static org.assertj.core.api.Assertions.assertThat;

import io.github.mauriciotorrez1.pos.core.CoreApplication;
import io.github.mauriciotorrez1.pos.db.PostgresTestConfiguration;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import io.github.mauriciotorrez1.pos.tenant.TenantContext;
import java.time.Duration;
import java.util.UUID;
import org.awaitility.Awaitility;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistrar;
import tools.jackson.databind.node.ObjectNode;

/** Without an API key the core starts, the cut is accepted, and the e-mail is skipped with a recorded reason. */
@SpringBootTest(classes = CoreApplication.class)
@Import({PostgresTestConfiguration.class, CutReportWithoutKeyTest.Wiring.class})
class CutReportWithoutKeyTest {

    private static final FakeResend RESEND = new FakeResend();

    @Autowired
    private SyncPushService service;

    @Autowired
    @Qualifier("adminJdbc")
    private JdbcTemplate admin;

    private final UUID tenant = Uuid7.next();
    private final UUID sessionId = Uuid7.next();
    private final UUID cutId = Uuid7.next();

    @Test
    void theCutIsAcceptedAndTheReportIsSkippedBecauseThereIsNoKey() {
        admin.update("INSERT INTO tenant (id, name, owner_email) VALUES (?, 'Tlapaleria Prueba', 'dueno@example.com')", tenant);

        assertThat(push()).containsOnly("accepted");

        awaitDelivery("skipped", "email_not_configured");
        assertThat(RESEND.received()).as("nothing was sent").isEmpty();
    }

    @Test
    void withoutAnyRecipientTheReportIsSkippedToo() {
        admin.update("INSERT INTO tenant (id, name) VALUES (?, 'Tlapaleria Prueba')", tenant);

        assertThat(push()).containsOnly("accepted");

        awaitDelivery("skipped", "no_recipient");
    }

    private java.util.List<String> push() {
        ObjectNode[] operations = {
            SyncFixtures.cashSessionOpened(Uuid7.next(), sessionId),
            SyncFixtures.cashCut(Uuid7.next(), sessionId, cutId, Uuid7.next())};
        return TenantContext.callAs(tenant, () -> service.push(batch(Uuid7.next(), operations)).results())
                .stream().map(SyncResult::status).toList();
    }

    private void awaitDelivery(String status, String error) {
        Awaitility.await().atMost(Duration.ofSeconds(20)).untilAsserted(() -> {
            var row = admin.queryForList("SELECT status, last_error FROM cut_report_delivery WHERE cut_id = ?", cutId);
            assertThat(row).hasSize(1);
            assertThat(row.get(0)).containsEntry("status", status).containsEntry("last_error", error);
        });
    }

    @TestConfiguration(proxyBeanMethods = false)
    static class Wiring {

        @Bean
        DynamicPropertyRegistrar noKey() {
            return registry -> {
                registry.add("spring.datasource.hikari.maximum-pool-size", () -> 12);
                registry.add("resend.base-url", RESEND::baseUrl);
                registry.add("resend.api-key", () -> "");
                registry.add("resend.from", () -> "");
                registry.add("reporting.default-recipient", () -> "");
            };
        }
    }
}
