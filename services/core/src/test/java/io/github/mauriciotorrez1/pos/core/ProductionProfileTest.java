package io.github.mauriciotorrez1.pos.core;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.mauriciotorrez1.pos.db.PostgresTestConfiguration;
import java.io.IOException;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureRestTestClient;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.context.annotation.Import;
import org.springframework.core.env.PropertySource;
import org.springframework.core.io.ClassPathResource;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.client.RestTestClient;

/**
 * Starts the core with the production profile of Cloud Run (ADR 0077). The test database still needs its
 * schema, so this test turns Flyway back on; in production the deploy workflow migrates before rolling out.
 */
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT, properties = "spring.flyway.enabled=true")
@AutoConfigureRestTestClient
@ActiveProfiles("prod")
@Import(PostgresTestConfiguration.class)
class ProductionProfileTest {

    @Autowired
    private RestTestClient client;

    @Test
    void answersTheStartupProbeOfCloudRun() {
        expectUp("/actuator/health/readiness");
    }

    @Test
    void answersTheLivenessProbeOfCloudRun() {
        expectUp("/actuator/health/liveness");
    }

    @Test
    void reportsTheDatabaseInTheHealthThatTheSmokeTestReads() {
        expectUp("/actuator/health");
    }

    @Test
    void neverMigratesFromTheRunningCoreAndTakesTheDatabaseOnlyFromTheEnvironment() throws IOException {
        PropertySource<?> profile = loadProductionProfile();

        assertThat(profile.getProperty("spring.flyway.enabled")).hasToString("false");
        assertThat(profile.getProperty("spring.datasource.url")).hasToString("${CORE_DB_URL}");
        assertThat(profile.getProperty("spring.datasource.username")).hasToString("${CORE_DB_USER}");
        assertThat(profile.getProperty("spring.datasource.password")).hasToString("${CORE_DB_PASSWORD}");
    }

    private void expectUp(String path) {
        client.get()
                .uri(path)
                .exchange()
                .expectStatus().isOk()
                .expectBody().jsonPath("$.status").isEqualTo("UP");
    }

    private static PropertySource<?> loadProductionProfile() throws IOException {
        List<PropertySource<?>> sources =
                new YamlPropertySourceLoader().load("prod", new ClassPathResource("application-prod.yaml"));
        assertThat(sources).hasSize(1);
        return sources.getFirst();
    }
}
