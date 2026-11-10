package io.github.mauriciotorrez1.pos.events;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import io.github.mauriciotorrez1.pos.core.CoreApplication;
import io.github.mauriciotorrez1.pos.core.PingEvent;
import io.github.mauriciotorrez1.pos.db.PostgresTestConfiguration;
import io.github.mauriciotorrez1.pos.db.RedpandaTestConfiguration;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import io.github.mauriciotorrez1.pos.tenant.TenantContext;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.ConsumerRecord;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.modulith.events.IncompleteEventPublications;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.redpanda.RedpandaContainer;

/** An event reaches Redpanda only if its transaction commits, and it waits in the outbox if the broker is down. */
@SpringBootTest(classes = CoreApplication.class)
@Import({PostgresTestConfiguration.class, RedpandaTestConfiguration.class})
class OutboxTest {

    private static final String TOPIC = "pos.test.ping.v1";

    @Autowired
    private ApplicationEventPublisher events;

    @Autowired
    private TransactionTemplate transaction;

    @Autowired
    private IncompleteEventPublications incomplete;

    @Autowired
    private RedpandaContainer redpanda;

    @Autowired
    @Qualifier("adminJdbc")
    private JdbcTemplate admin;

    @Value("${spring.kafka.bootstrap-servers}")
    private String bootstrapServers;

    private final UUID tenant = Uuid7.next();

    @BeforeEach
    void cleanOutbox() {
        admin.execute("DELETE FROM event_publication");
    }

    @Test
    void aCommittedTransactionPublishesItsEvent() {
        UUID eventId = Uuid7.next();

        publish(eventId, "committed", false);

        List<ConsumerRecord<String, String>> received = consumeUntil(eventId);
        assertThat(received).hasSize(1);
        assertThat(received.get(0).key()).isEqualTo(tenant.toString());
        assertThat(received.get(0).value()).contains(eventId.toString()).contains(tenant.toString()).contains("committed");
        await().atMost(Duration.ofSeconds(20)).untilAsserted(() -> assertThat(pendingPublications()).isZero());
    }

    @Test
    void aRolledBackTransactionPublishesNothing() {
        UUID eventId = Uuid7.next();

        try {
            publish(eventId, "rolled back", true);
        } catch (IllegalStateException expected) {
            // the transaction is rolled back on purpose
        }

        assertThat(admin.queryForObject("SELECT count(*) FROM event_publication", Integer.class)).isZero();
        assertThat(consumeFor(eventId, Duration.ofSeconds(5))).isEmpty();
    }

    @Test
    void anEventWaitsInTheOutboxWhileTheBrokerIsDownAndIsPublishedWhenItReturns() {
        UUID eventId = Uuid7.next();
        String container = redpanda.getContainerId();
        redpanda.getDockerClient().pauseContainerCmd(container).exec();
        try {
            publish(eventId, "broker down", false);

            assertThat(admin.queryForObject("SELECT count(*) FROM event_publication", Integer.class)).isEqualTo(1);
            assertThat(pendingPublications()).isEqualTo(1);
        } finally {
            redpanda.getDockerClient().unpauseContainerCmd(container).exec();
        }

        await().atMost(Duration.ofSeconds(60)).untilAsserted(() -> {
            incomplete.resubmitIncompletePublications(publication -> true);
            assertThat(pendingPublications()).isZero();
        });
        assertThat(consumeUntil(eventId)).isNotEmpty();
    }

    private void publish(UUID eventId, String message, boolean failAfterwards) {
        TenantContext.runAs(tenant, () -> transaction.executeWithoutResult(status -> {
            events.publishEvent(new PingEvent(eventId, tenant, 1, message));
            if (failAfterwards) {
                throw new IllegalStateException("boom");
            }
        }));
    }

    private int pendingPublications() {
        return admin.queryForObject("SELECT count(*) FROM event_publication WHERE completion_date IS NULL", Integer.class);
    }

    private List<ConsumerRecord<String, String>> consumeUntil(UUID eventId) {
        return consumeFor(eventId, Duration.ofSeconds(30));
    }

    /** Reads the topic from the start and returns the records that carry the event id. */
    private List<ConsumerRecord<String, String>> consumeFor(UUID eventId, Duration timeout) {
        Map<String, Object> config = Map.of(
                ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, bootstrapServers,
                ConsumerConfig.GROUP_ID_CONFIG, "outbox-test-" + UUID.randomUUID(),
                ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest",
                ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class,
                ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
        List<ConsumerRecord<String, String>> found = new java.util.ArrayList<>();
        long deadline = System.nanoTime() + timeout.toNanos();
        try (KafkaConsumer<String, String> consumer = new KafkaConsumer<>(config)) {
            consumer.subscribe(List.of(TOPIC));
            while (System.nanoTime() < deadline) {
                for (ConsumerRecord<String, String> record : consumer.poll(Duration.ofMillis(500))) {
                    if (record.value().contains(eventId.toString())) {
                        found.add(record);
                    }
                }
                if (!found.isEmpty()) {
                    break;
                }
            }
        }
        return found;
    }
}
