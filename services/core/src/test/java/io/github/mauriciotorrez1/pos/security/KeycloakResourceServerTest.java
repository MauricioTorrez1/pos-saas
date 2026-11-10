package io.github.mauriciotorrez1.pos.security;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.mauriciotorrez1.pos.core.CoreApplication;
import io.github.mauriciotorrez1.pos.db.PostgresTestConfiguration;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureRestTestClient;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.client.RestTestClient;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The core validates real Keycloak tokens (F0-13): 401 without a valid token, 403 without a tenant,
 * and the tenant of the token reaches row-level security so two businesses never see each other.
 */
@SpringBootTest(classes = CoreApplication.class, webEnvironment = WebEnvironment.RANDOM_PORT)
@AutoConfigureRestTestClient
@Import({PostgresTestConfiguration.class, KeycloakTestConfiguration.class, KeycloakResourceServerTest.BranchesEndpoint.class})
class KeycloakResourceServerTest {

    private static final UUID TENANT_A = Uuid7.next();
    private static final UUID TENANT_B = Uuid7.next();

    @Autowired
    private RestTestClient client;

    @Autowired
    private KeycloakTestClient keycloak;

    @Autowired
    @Qualifier("adminJdbc")
    private JdbcTemplate admin;

    private static boolean prepared;

    @BeforeAll
    static void resetPreparation() {
        prepared = false;
    }

    /** Seeds once per class: a Keycloak user per business, one without tenant, and a branch per business. */
    private void prepare() {
        if (prepared) {
            return;
        }
        keycloak.allowPasswordGrant();
        keycloak.createUser("alice", TENANT_A);
        keycloak.createUser("bob", TENANT_B);
        keycloak.createUser("nobody", null);
        admin.execute("TRUNCATE app_user, register, branch, tenant CASCADE");
        seed(TENANT_A, "A");
        seed(TENANT_B, "B");
        prepared = true;
    }

    @Test
    void healthIsPublic() {
        client.get().uri("/actuator/health").exchange().expectStatus().isOk();
    }

    @Test
    void meWithoutTokenIs401() {
        client.get().uri("/me").exchange().expectStatus().isUnauthorized();
    }

    @Test
    void meWithGarbageTokenIs401() {
        client.get().uri("/me").header("Authorization", "Bearer not-a-jwt").exchange().expectStatus().isUnauthorized();
    }

    @Test
    void aTokenFromAnotherRealmIs401() {
        prepare();
        client.get().uri("/me").header("Authorization", "Bearer " + keycloak.foreignRealmToken())
                .exchange().expectStatus().isUnauthorized();
    }

    @Test
    void aValidTokenWithoutTenantIs403() {
        prepare();
        client.get().uri("/me").header("Authorization", bearer("nobody")).exchange().expectStatus().isForbidden();
    }

    @Test
    void aValidTokenPinsTheTenantOfTheToken() {
        prepare();
        client.get().uri("/me").header("Authorization", bearer("alice"))
                .exchange()
                .expectStatus().isOk()
                .expectBody()
                .jsonPath("$.tenantId").isEqualTo(TENANT_A.toString())
                .jsonPath("$.subject").isNotEmpty()
                .jsonPath("$.email").doesNotExist();
    }

    @Test
    void twoBusinessesNeverSeeEachOthersRows() {
        prepare();
        assertThat(branchesSeenBy("alice")).containsExactly("A");
        assertThat(branchesSeenBy("bob")).containsExactly("B");
    }

    private List<String> branchesSeenBy(String user) {
        return client.get().uri("/test/branches").header("Authorization", bearer(user))
                .exchange()
                .expectStatus().isOk()
                .expectBody(new org.springframework.core.ParameterizedTypeReference<List<String>>() { })
                .returnResult().getResponseBody();
    }

    private String bearer(String user) {
        return "Bearer " + keycloak.accessToken(user);
    }

    private void seed(UUID tenant, String code) {
        admin.update("INSERT INTO tenant (id, name) VALUES (?, ?)", tenant, "Business " + code);
        admin.update("INSERT INTO branch (id, tenant_id, code, name) VALUES (?, ?, ?, ?)",
                Uuid7.next(), tenant, code, "Branch " + code);
    }

    /** Reads through the application role, exactly as a real endpoint would, so RLS decides what is returned. */
    @TestConfiguration(proxyBeanMethods = false)
    static class BranchesEndpoint {

        @Bean
        BranchesController branchesController(JdbcTemplate app, TransactionTemplate transaction) {
            return new BranchesController(app, transaction);
        }
    }

    @RestController
    static class BranchesController {

        private final JdbcTemplate app;
        private final TransactionTemplate transaction;

        BranchesController(JdbcTemplate app, TransactionTemplate transaction) {
            this.app = app;
            this.transaction = transaction;
        }

        @GetMapping("/test/branches")
        List<String> branches() {
            return transaction.execute(status -> app.queryForList("SELECT code FROM branch ORDER BY code", String.class));
        }
    }
}
