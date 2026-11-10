package io.github.mauriciotorrez1.pos.core.sync;

import static io.github.mauriciotorrez1.pos.core.sync.SyncFixtures.batch;
import static org.assertj.core.api.Assertions.assertThat;

import io.github.mauriciotorrez1.pos.core.CoreApplication;
import io.github.mauriciotorrez1.pos.db.PostgresTestConfiguration;
import io.github.mauriciotorrez1.pos.events.CashCutRecorded;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import io.github.mauriciotorrez1.pos.tenant.TenantContext;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.awaitility.Awaitility;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.modulith.events.IncompleteEventPublications;
import org.springframework.test.context.DynamicPropertyRegistrar;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.node.ObjectNode;

/**
 * The e-mail of a cash cut (RF-028, E1-24): sent once, retried a bounded number of times, never in the
 * way of {@code /sync/push}. The database is a real PostgreSQL and the provider is a fake HTTP server,
 * so the real Resend sender, the outbox and the listener run as in production.
 */
@SpringBootTest(classes = CoreApplication.class)
@Import({PostgresTestConfiguration.class, CutReportEmailTest.Wiring.class})
class CutReportEmailTest {

    private static final FakeResend RESEND = new FakeResend();

    @Autowired
    private SyncPushService service;

    @Autowired
    private IncompleteEventPublications incomplete;

    @Autowired
    private ApplicationEventPublisher events;

    @Autowired
    private TransactionTemplate transaction;

    @Autowired
    @Qualifier("adminJdbc")
    private JdbcTemplate admin;

    private final UUID tenant = Uuid7.next();
    private final UUID register = Uuid7.next();
    private final UUID sessionId = Uuid7.next();
    private final UUID cutId = Uuid7.next();

    @BeforeEach
    void freshProvider() {
        RESEND.reset();
        admin.update("INSERT INTO tenant (id, name, owner_email) VALUES (?, 'Tlapaleria Prueba', 'dueno@example.com')", tenant);
    }

    @Test
    void theOwnerGetsOneSpanishEmailWithTheTotalsTheCountAndTheWithdrawals() {
        pushACut();

        awaitStatus("sent");

        assertThat(RESEND.received()).hasSize(1);
        FakeResend.Received sent = RESEND.received().get(0);
        assertThat(sent.authorization()).isEqualTo("Bearer re_test_key");
        assertThat(sent.idempotencyKey()).isEqualTo("cut-report-" + cutId);
        assertThat(sent.body().get("to").get(0).asString()).isEqualTo("dueno@example.com");
        assertThat(sent.body().get("from").asString()).isEqualTo("Reportes <reportes@example.com>");
        assertThat(sent.body().get("subject").asString()).startsWith("Corte de caja de Tlapaleria Prueba");
        String text = sent.body().get("text").asString();
        assertThat(text).contains("1 venta por $116.00").contains("Efectivo: $116.00")
                .contains("Salida: $200.00 - Partial withdrawal")
                .contains("Efectivo: esperado $416.00, contado $415.00, faltan $1.00")
                .contains("Diferencia total: faltan $1.00").contains("Motivo anotado: A missing $1.00 in coins")
                .contains("No contiene datos de clientes");
        assertThat(admin.queryForObject("SELECT attempts FROM cut_report_delivery WHERE cut_id = ?", Integer.class, cutId)).isOne();
    }

    @Test
    void aCutThatArrivesTwiceOrIsHandledTwiceSendsOneEmail() {
        ObjectNode[] operations = cutBatch();
        push(operations);
        awaitStatus("sent");

        // The register resends the same batch: every operation is a duplicate and no event is published again.
        assertThat(push(operations)).containsOnly("duplicate");
        // The outbox redelivers the same event, twice and at once: the delivery row lets only one through.
        for (int i = 0; i < 2; i++) {
            TenantContext.runAs(tenant, () -> transaction.executeWithoutResult(status ->
                    events.publishEvent(CashCutRecorded.of(Uuid7.next(), tenant, cutId, sessionId))));
        }
        incomplete.resubmitIncompletePublicationsOlderThan(Duration.ZERO);

        Awaitility.await().pollDelay(Duration.ofSeconds(2)).atMost(Duration.ofSeconds(10))
                .untilAsserted(() -> assertThat(RESEND.received()).hasSize(1));
        assertThat(admin.queryForObject("SELECT count(*) FROM cut_report_delivery WHERE cut_id = ?", Integer.class, cutId)).isOne();
    }

    @Test
    void aProviderThatFailsIsRetriedWithTheSameKeyAndThenTheEmailIsSentOnce() {
        RESEND.script(503, 500);
        pushACut();
        awaitStatus("failed");

        offerPendingEventsUntil("sent");

        assertThat(RESEND.received()).hasSize(3);
        assertThat(RESEND.received()).extracting(FakeResend.Received::idempotencyKey).containsOnly("cut-report-" + cutId);
        assertThat(admin.queryForObject("SELECT attempts FROM cut_report_delivery WHERE cut_id = ?", Integer.class, cutId)).isEqualTo(3);
        assertThat(admin.queryForObject("SELECT sent_at IS NOT NULL FROM cut_report_delivery WHERE cut_id = ?", Boolean.class, cutId)).isTrue();
    }

    @Test
    void retriesAreBoundedAndTheDeliveryIsGivenUp() {
        RESEND.alwaysAnswer(503);
        pushACut();

        offerPendingEventsUntil("gave_up");

        assertThat(RESEND.received()).hasSize(5);
        assertThat(admin.queryForObject("SELECT last_error FROM cut_report_delivery WHERE cut_id = ?", String.class, cutId))
                .contains("EmailUnavailableException").doesNotContain("dueno@example.com");
        incomplete.resubmitIncompletePublicationsOlderThan(Duration.ZERO);
        Awaitility.await().pollDelay(Duration.ofSeconds(1)).atMost(Duration.ofSeconds(5))
                .untilAsserted(() -> assertThat(RESEND.received()).as("no sixth attempt").hasSize(5));
    }

    @Test
    void aRefusalFromTheProviderIsNotRetried() {
        RESEND.alwaysAnswer(401);
        pushACut();

        awaitStatus("rejected");
        incomplete.resubmitIncompletePublicationsOlderThan(Duration.ZERO);

        Awaitility.await().pollDelay(Duration.ofSeconds(1)).atMost(Duration.ofSeconds(5))
                .untilAsserted(() -> assertThat(RESEND.received()).hasSize(1));
        assertThat(admin.queryForObject("SELECT last_error FROM cut_report_delivery WHERE cut_id = ?", String.class, cutId))
                .isEqualTo("provider_status_401");
    }

    @Test
    void aSlowProviderNeverDelaysThePush() {
        RESEND.delayAnswers(3000);
        ObjectNode[] operations = cutBatch();

        long started = System.nanoTime();
        List<String> statuses = push(operations);
        long elapsedMillis = Duration.ofNanos(System.nanoTime() - started).toMillis();

        assertThat(statuses).containsOnly("accepted");
        assertThat(elapsedMillis).as("the push does not wait for the e-mail").isLessThan(2500);
        awaitStatus("sent");
    }

    @Test
    void theRecipientOfTheBusinessComesBeforeTheDefaultOne() {
        pushACut();
        awaitStatus("sent");

        assertThat(RESEND.received().get(0).body().get("to").get(0).asString()).isEqualTo("dueno@example.com");
    }

    @Test
    void aBusinessWithoutOwnerEmailUsesTheDefaultRecipient() {
        admin.update("UPDATE tenant SET owner_email = NULL WHERE id = ?", tenant);
        pushACut();
        awaitStatus("sent");

        assertThat(RESEND.received().get(0).body().get("to").get(0).asString()).isEqualTo("default@example.com");
    }

    private ObjectNode[] cutBatch() {
        ObjectNode sale = SyncFixtures.sale(Uuid7.next());
        ((ObjectNode) sale.get("payload")).put("cashSessionId", sessionId.toString());
        return new ObjectNode[] {
            SyncFixtures.cashSessionOpened(Uuid7.next(), sessionId),
            sale,
            SyncFixtures.cashMovement(Uuid7.next(), sessionId),
            SyncFixtures.cashCut(Uuid7.next(), sessionId, cutId, Uuid7.next())};
    }

    private void pushACut() {
        assertThat(push(cutBatch())).containsOnly("accepted");
    }

    private List<String> push(ObjectNode... operations) {
        return TenantContext.callAs(tenant, () -> service.push(batch(register, operations)).results())
                .stream().map(SyncResult::status).toList();
    }

    private void awaitStatus(String expected) {
        Awaitility.await().atMost(Duration.ofSeconds(20)).untilAsserted(() ->
                assertThat(admin.queryForList("SELECT status FROM cut_report_delivery WHERE cut_id = ?", String.class, cutId))
                        .containsExactly(expected));
    }

    /** The scheduler of the core does the same every 30 seconds; the test does not wait for it. */
    private void offerPendingEventsUntil(String expected) {
        Awaitility.await().atMost(Duration.ofSeconds(30)).pollInterval(Duration.ofMillis(300)).untilAsserted(() -> {
            incomplete.resubmitIncompletePublicationsOlderThan(Duration.ZERO);
            assertThat(admin.queryForList("SELECT status FROM cut_report_delivery WHERE cut_id = ?", String.class, cutId))
                    .containsExactly(expected);
        });
    }

    /** Points the core at the fake provider with a key, no waiting between attempts, and a pool wide enough for the listener threads. */
    @TestConfiguration(proxyBeanMethods = false)
    static class Wiring {

        @Bean
        DynamicPropertyRegistrar fakeProvider() {
            return registry -> {
                registry.add("spring.datasource.hikari.maximum-pool-size", () -> 12);
                registry.add("resend.base-url", RESEND::baseUrl);
                registry.add("resend.api-key", () -> "re_test_key");
                registry.add("resend.from", () -> "Reportes <reportes@example.com>");
                registry.add("reporting.default-recipient", () -> "default@example.com");
                registry.add("reporting.retry-base", () -> "0s");
            };
        }
    }
}
