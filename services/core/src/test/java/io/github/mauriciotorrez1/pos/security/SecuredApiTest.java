package io.github.mauriciotorrez1.pos.security;

import io.github.mauriciotorrez1.pos.core.CoreApplication;
import io.github.mauriciotorrez1.pos.core.identity.Role;
import io.github.mauriciotorrez1.pos.db.PostgresTestConfiguration;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import java.util.UUID;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.resttestclient.autoconfigure.AutoConfigureRestTestClient;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.client.RestTestClient;

/**
 * Base of the tests that call the API with real Keycloak tokens. The subclasses share one Spring
 * context (one PostgreSQL and one Keycloak), so each of them seeds its own business and never
 * truncates tables.
 */
@SpringBootTest(classes = CoreApplication.class, webEnvironment = WebEnvironment.RANDOM_PORT)
@AutoConfigureRestTestClient
@Import({PostgresTestConfiguration.class, KeycloakTestConfiguration.class})
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
abstract class SecuredApiTest {

    @Autowired
    protected RestTestClient client;

    @Autowired
    protected KeycloakTestClient keycloak;

    @Autowired
    @Qualifier("adminJdbc")
    protected JdbcTemplate admin;

    /** A person with a Keycloak login and a user row, as the panel would have after the owner invites them. */
    protected static final class Actor {

        private final String username;
        private final UUID userId;
        private final KeycloakTestClient keycloak;
        private String token;

        Actor(String username, UUID userId, KeycloakTestClient keycloak) {
            this.username = username;
            this.userId = userId;
            this.keycloak = keycloak;
        }

        /** The id of the user row. */
        protected UUID id() {
            return userId;
        }

        /** The {@code Authorization} header value of a real access token, requested once. */
        protected String bearer() {
            if (token == null) {
                token = keycloak.accessToken(username);
            }
            return "Bearer " + token;
        }
    }

    /**
     * Creates a business with one branch.
     *
     * @return the id of the business
     */
    protected UUID seedTenant() {
        UUID tenant = Uuid7.next();
        admin.update("INSERT INTO tenant (id, name) VALUES (?, ?)", tenant, "Business " + tenant);
        admin.update("INSERT INTO branch (id, tenant_id, code, name) VALUES (?, ?, 'MAIN', 'Main branch')", Uuid7.next(), tenant);
        return tenant;
    }

    /**
     * Creates a user with a Keycloak login and a row of {@code app_user}.
     *
     * @param tenant the business of the user
     * @param role   the role stored for the user
     * @param active whether the user is active
     * @return the new person
     */
    protected Actor seedActor(UUID tenant, Role role, boolean active) {
        keycloak.allowPasswordGrant();
        String username = role.value() + "-" + UUID.randomUUID().toString().substring(0, 8);
        String subject = keycloak.createUser(username, tenant);
        UUID userId = Uuid7.next();
        admin.update("INSERT INTO app_user (id, tenant_id, display_name, role, keycloak_subject, active) VALUES (?, ?, ?, ?, ?, ?)",
                userId, tenant, username, role.value(), subject, active);
        return new Actor(username, userId, keycloak);
    }

    /**
     * Creates a Keycloak login for the business without any {@code app_user} row.
     *
     * @param tenant the business to put in the token
     * @return the person, whose id is meaningless
     */
    protected Actor seedLoginWithoutUser(UUID tenant) {
        keycloak.allowPasswordGrant();
        String username = "ghost-" + UUID.randomUUID().toString().substring(0, 8);
        keycloak.createUser(username, tenant);
        return new Actor(username, Uuid7.next(), keycloak);
    }

    /**
     * Calls the API and returns only the status code.
     *
     * @param actor  who calls, or {@code null} for no token
     * @param method the HTTP method
     * @param path   the path, with every placeholder already replaced
     * @param body   the JSON body, or {@code null}
     * @return the HTTP status code
     */
    protected int status(Actor actor, HttpMethod method, String path, String body) {
        RestTestClient.RequestBodySpec request = client.method(method).uri(path);
        if (actor != null) {
            request = request.header("Authorization", actor.bearer());
        }
        if (body != null) {
            request = request.contentType(MediaType.APPLICATION_JSON);
            return request.body(body).exchange().expectBody(String.class).returnResult().getStatus().value();
        }
        return request.exchange().expectBody(String.class).returnResult().getStatus().value();
    }

    /**
     * Calls {@code GET} on the API and returns the JSON body.
     *
     * @param actor who calls
     * @param path  the path
     * @return the response body
     */
    protected String bodyOf(Actor actor, String path) {
        return client.get().uri(path).header("Authorization", actor.bearer())
                .exchange().expectBody(String.class).returnResult().getResponseBody();
    }
}
