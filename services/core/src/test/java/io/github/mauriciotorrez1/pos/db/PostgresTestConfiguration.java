package io.github.mauriciotorrez1.pos.db;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * Starts the same PostgreSQL line as {@code infra/compose} and wires it as the datasource of a Spring test.
 * Tests of the application import it, so Flyway migrates an empty database every time.
 */
@TestConfiguration(proxyBeanMethods = false)
public class PostgresTestConfiguration {

    static final String IMAGE = "postgres:16.15";

    @Bean
    @ServiceConnection
    PostgreSQLContainer postgres() {
        return new PostgreSQLContainer(IMAGE);
    }
}
