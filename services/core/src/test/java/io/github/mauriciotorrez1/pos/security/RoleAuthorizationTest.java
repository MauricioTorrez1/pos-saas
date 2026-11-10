package io.github.mauriciotorrez1.pos.security;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.mauriciotorrez1.pos.core.identity.Role;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.EnumSource;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.http.HttpMethod;

/**
 * Roles and permissions with real Keycloak tokens (F0-14, RF-008): the matrix of role and endpoint
 * answers 403 or something else, a cashier cannot change prices and the attempt is audited, and role
 * changes are audited and apply at once.
 */
class RoleAuthorizationTest extends SecuredApiTest {

    private UUID tenant;
    private final Map<Role, Actor> actors = new java.util.EnumMap<>(Role.class);

    @BeforeAll
    void seed() {
        tenant = seedTenant();
        for (Role role : Role.values()) {
            actors.put(role, seedActor(tenant, role, true));
        }
    }

    static Stream<Arguments> roleAndRule() {
        return Stream.of(Role.values()).flatMap(role -> EndpointPermissions.RULES.stream().map(rule -> Arguments.of(role, rule)));
    }

    @ParameterizedTest(name = "{0} on {1}")
    @MethodSource("roleAndRule")
    void everyRoleGetsWhatTheMatrixSaysOnEveryEndpoint(Role role, EndpointRule rule) {
        boolean allowed = rule.access() != EndpointRule.Access.PERMISSION || rule.permission().grantedTo(role);

        int status = status(actors.get(role), rule.method(), rule.pattern().replace("{id}", UUID.randomUUID().toString()),
                rule.method() == HttpMethod.GET ? null : "{}");

        if (allowed) {
            // The endpoint may not exist yet (404) or reject the empty body (400, 415): anything but a denial.
            assertThat(status).as("%s %s as %s", rule.method(), rule.pattern(), role).isNotIn(401, 403);
        } else {
            assertThat(status).as("%s %s as %s", rule.method(), rule.pattern(), role).isEqualTo(403);
        }
    }

    @ParameterizedTest
    @EnumSource(Role.class)
    void meReturnsTheRoleStoredForTheUser(Role role) {
        assertThat(bodyOf(actors.get(role), "/me")).contains("\"role\":\"" + role.value() + "\"");
    }

    @Test
    void meReturnsNoRoleWhenTheTokenMatchesNoUserButKeepsTheTenant() {
        Actor ghost = seedLoginWithoutUser(tenant);

        assertThat(bodyOf(ghost, "/me")).contains("\"tenantId\":\"" + tenant + "\"").contains("\"role\":null");
    }

    @Test
    void aCashierCannotChangePricesAndTheAttemptIsAudited() {
        Actor cashier = actors.get(Role.CASHIER);

        assertThat(status(cashier, HttpMethod.POST, "/price-changes", "{}")).isEqualTo(403);

        List<Map<String, Object>> entries = admin.queryForList("""
                SELECT new_value::text AS detail FROM audit_log
                WHERE tenant_id = ? AND actor_id = ? AND action = 'access.denied' AND new_value->>'permission' = 'price.change'
                """, tenant, cashier.id());
        assertThat(entries).isNotEmpty();
        assertThat(entries.get(0).get("detail").toString()).contains("price.change", "missing_permission", "cashier");
    }

    @Test
    void anOwnerChangesPricesWithoutBeingDenied() {
        assertThat(status(actors.get(Role.OWNER), HttpMethod.POST, "/price-changes", "{}")).isNotIn(401, 403);
    }

    @Test
    void withoutATokenTheAnswerIs401() {
        assertThat(status(null, HttpMethod.GET, "/products", null)).isEqualTo(401);
    }

    @Test
    void aValidTokenWithoutAUserIsDeniedAndAudited() {
        Actor ghost = seedLoginWithoutUser(tenant);

        assertThat(status(ghost, HttpMethod.GET, "/products", null)).isEqualTo(403);
        assertThat(status(ghost, HttpMethod.GET, "/me", null)).isEqualTo(200);

        Long entries = admin.queryForObject("""
                SELECT count(*) FROM audit_log
                WHERE tenant_id = ? AND actor_id IS NULL AND action = 'access.denied' AND new_value->>'reason' = 'no_user'
                """, Long.class, tenant);
        assertThat(entries).isPositive();
    }

    @Test
    void aDeactivatedUserIsDenied() {
        Actor retired = seedActor(tenant, Role.CASHIER, false);

        assertThat(status(retired, HttpMethod.GET, "/products", null)).isEqualTo(403);
    }

    @Test
    void anEndpointNobodyListedIsDeniedToEveryone() {
        assertThat(status(actors.get(Role.OWNER), HttpMethod.GET, "/not-in-the-table", null)).isEqualTo(403);
    }

    @Test
    void aRoleChangeIsAuditedAndAppliesToTheNextRequestWithTheSameToken() {
        Actor owner = actors.get(Role.OWNER);
        Actor cashier = seedActor(tenant, Role.CASHIER, true);
        assertThat(status(cashier, HttpMethod.GET, "/reports/sales", null)).isEqualTo(403);

        int changed = status(owner, HttpMethod.PUT, "/users/" + cashier.id() + "/role", "{\"role\": \"manager\"}");

        assertThat(changed).isEqualTo(200);
        assertThat(status(cashier, HttpMethod.GET, "/reports/sales", null)).isNotIn(401, 403);
        Map<String, Object> entry = admin.queryForMap("""
                SELECT actor_id, old_value::text AS old_value, new_value::text AS new_value FROM audit_log
                WHERE tenant_id = ? AND entity_id = ? AND action = 'user.role_changed'
                """, tenant, cashier.id());
        assertThat(entry.get("actor_id")).isEqualTo(owner.id());
        assertThat(entry.get("old_value").toString()).contains("cashier");
        assertThat(entry.get("new_value").toString()).contains("manager");
    }

    @Test
    void givingTheSameRoleAgainWritesNothing() {
        Actor cashier = seedActor(tenant, Role.CASHIER, true);

        assertThat(status(actors.get(Role.OWNER), HttpMethod.PUT, "/users/" + cashier.id() + "/role", "{\"role\": \"cashier\"}"))
                .isEqualTo(200);

        Long entries = admin.queryForObject("SELECT count(*) FROM audit_log WHERE entity_id = ?", Long.class, cashier.id());
        assertThat(entries).isZero();
    }

    @Test
    void theLastOwnerCannotBeDemoted() {
        UUID soloTenant = seedTenant();
        Actor soloOwner = seedActor(soloTenant, Role.OWNER, true);

        assertThat(status(soloOwner, HttpMethod.PUT, "/users/" + soloOwner.id() + "/role", "{\"role\": \"manager\"}")).isEqualTo(409);

        assertThat(admin.queryForObject("SELECT role FROM app_user WHERE id = ?", String.class, soloOwner.id())).isEqualTo("owner");
    }

    @Test
    void anOwnerCanStepDownWhenAnotherOwnerRemains() {
        UUID pairTenant = seedTenant();
        Actor first = seedActor(pairTenant, Role.OWNER, true);
        seedActor(pairTenant, Role.OWNER, true);

        assertThat(status(first, HttpMethod.PUT, "/users/" + first.id() + "/role", "{\"role\": \"manager\"}")).isEqualTo(200);
    }

    @Test
    void anUnknownRoleIs400AndAnUnknownUserIs404() {
        Actor owner = actors.get(Role.OWNER);

        assertThat(status(owner, HttpMethod.PUT, "/users/" + actors.get(Role.CASHIER).id() + "/role", "{\"role\": \"admin\"}")).isEqualTo(400);
        assertThat(status(owner, HttpMethod.PUT, "/users/" + UUID.randomUUID() + "/role", "{\"role\": \"manager\"}")).isEqualTo(404);
    }

    @Test
    void anOwnerCannotChangeTheRoleOfAnotherBusinessUser() {
        UUID otherTenant = seedTenant();
        Actor stranger = seedActor(otherTenant, Role.CASHIER, true);

        assertThat(status(actors.get(Role.OWNER), HttpMethod.PUT, "/users/" + stranger.id() + "/role", "{\"role\": \"manager\"}"))
                .isEqualTo(404);
        assertThat(admin.queryForObject("SELECT role FROM app_user WHERE id = ?", String.class, stranger.id())).isEqualTo("cashier");
    }
}
