package io.github.mauriciotorrez1.pos.security;

import java.nio.file.Path;
import java.time.Duration;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.test.context.DynamicPropertyRegistrar;
import org.testcontainers.containers.GenericContainer;
import org.testcontainers.containers.wait.strategy.Wait;
import org.testcontainers.utility.MountableFile;

/**
 * Starts the same Keycloak line as {@code infra/compose} and imports the real realm file of the
 * repository, so the tests prove that the realm exported for Compose issues what the core expects.
 */
@TestConfiguration(proxyBeanMethods = false)
public class KeycloakTestConfiguration {

    static final String IMAGE = "quay.io/keycloak/keycloak:26.8.1";
    static final String ADMIN_USER = "admin";
    static final String ADMIN_PASSWORD = "keycloak-test-admin-password";
    static final String REALM = "pos";

    private static final Path REALM_FILE = Path.of("../../infra/compose/keycloak/pos-realm.json").toAbsolutePath().normalize();

    @Bean
    GenericContainer<?> keycloak() {
        return new GenericContainer<>(IMAGE)
                .withEnv("KC_BOOTSTRAP_ADMIN_USERNAME", ADMIN_USER)
                .withEnv("KC_BOOTSTRAP_ADMIN_PASSWORD", ADMIN_PASSWORD)
                .withCopyFileToContainer(MountableFile.forHostPath(REALM_FILE), "/opt/keycloak/data/import/pos-realm.json")
                .withCommand("start-dev", "--import-realm")
                .withExposedPorts(8080)
                .waitingFor(Wait.forHttp("/realms/" + REALM).forPort(8080).withStartupTimeout(Duration.ofMinutes(3)));
    }

    @Bean
    DynamicPropertyRegistrar oidcProperties(GenericContainer<?> keycloak) {
        return registry -> {
            String issuer = baseUrl(keycloak) + "/realms/" + REALM;
            registry.add("spring.security.oauth2.resourceserver.jwt.issuer-uri", () -> issuer);
            registry.add("spring.security.oauth2.resourceserver.jwt.jwk-set-uri", () -> issuer + "/protocol/openid-connect/certs");
        };
    }

    @Bean
    KeycloakTestClient keycloakClient(GenericContainer<?> keycloak) {
        return new KeycloakTestClient(baseUrl(keycloak));
    }

    private static String baseUrl(GenericContainer<?> keycloak) {
        return "http://" + keycloak.getHost() + ":" + keycloak.getMappedPort(8080);
    }
}
