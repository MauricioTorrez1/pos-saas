package io.github.mauriciotorrez1.pos.db;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.test.context.DynamicPropertyRegistrar;
import org.testcontainers.redpanda.RedpandaContainer;

/** Starts the same Redpanda line as {@code infra/compose} and points the Kafka client at it. */
@TestConfiguration(proxyBeanMethods = false)
public class RedpandaTestConfiguration {

    static final String IMAGE = "redpandadata/redpanda:v26.2.6";

    @Bean
    RedpandaContainer redpanda() {
        return new RedpandaContainer(IMAGE);
    }

    @Bean
    DynamicPropertyRegistrar kafkaProperties(RedpandaContainer redpanda) {
        return registry -> {
            registry.add("spring.kafka.bootstrap-servers", redpanda::getBootstrapServers);
            // A paused broker must fail fast so the event stays in the outbox instead of blocking the commit.
            registry.add("spring.kafka.producer.properties.max.block.ms", () -> 3000);
            registry.add("spring.kafka.producer.properties.delivery.timeout.ms", () -> 6000);
            registry.add("spring.kafka.producer.properties.request.timeout.ms", () -> 3000);
        };
    }
}
