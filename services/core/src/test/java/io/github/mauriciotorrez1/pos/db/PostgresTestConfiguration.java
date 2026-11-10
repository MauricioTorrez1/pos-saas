package io.github.mauriciotorrez1.pos.db;

import javax.sql.DataSource;
import org.springframework.boot.flyway.autoconfigure.FlywayMigrationStrategy;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.context.DynamicPropertyRegistrar;
import org.testcontainers.postgresql.PostgreSQLContainer;

/**
 * Starts the same PostgreSQL line as {@code infra/compose} and wires it like production: Flyway
 * migrates with the container superuser (the migration role) while the application connects as
 * {@code pos_app}, the role without BYPASSRLS that the V2 migration creates (ADR 0035).
 */
@TestConfiguration(proxyBeanMethods = false)
public class PostgresTestConfiguration {

    static final String IMAGE = "postgres:16.15";
    static final String APP_ROLE = "pos_app";
    static final String APP_PASSWORD = "pos-app-test-password";

    @Bean
    PostgreSQLContainer postgres() {
        return new PostgreSQLContainer(IMAGE);
    }

    @Bean
    DynamicPropertyRegistrar databaseProperties(PostgreSQLContainer postgres) {
        return registry -> {
            registry.add("spring.datasource.url", postgres::getJdbcUrl);
            registry.add("spring.datasource.username", () -> APP_ROLE);
            registry.add("spring.datasource.password", () -> APP_PASSWORD);
            registry.add("spring.datasource.hikari.maximum-pool-size", () -> 1);
            registry.add("spring.flyway.url", postgres::getJdbcUrl);
            registry.add("spring.flyway.user", postgres::getUsername);
            registry.add("spring.flyway.password", postgres::getPassword);
        };
    }

    /** Migrates, then gives the application role the password that a deployment would set. */
    @Bean
    FlywayMigrationStrategy migrateAndSetAppPassword(PostgreSQLContainer postgres) {
        // A plain template: a JdbcTemplate bean would depend on Flyway and form a cycle.
        return flyway -> {
            flyway.migrate();
            new JdbcTemplate(adminDataSource(postgres)).execute("ALTER ROLE " + APP_ROLE + " PASSWORD '" + APP_PASSWORD + "'");
        };
    }

    /** The template of the application role, the one the services use. */
    @Bean
    @Primary
    JdbcTemplate appJdbc(DataSource dataSource) {
        return new JdbcTemplate(dataSource);
    }

    /** A connection as the migration role (superuser here), for seeding and cleaning data past RLS. */
    @Bean
    JdbcTemplate adminJdbc(PostgreSQLContainer postgres) {
        return new JdbcTemplate(adminDataSource(postgres));
    }

    private static DataSource adminDataSource(PostgreSQLContainer postgres) {
        return new DriverManagerDataSource(postgres.getJdbcUrl(), postgres.getUsername(), postgres.getPassword());
    }
}
