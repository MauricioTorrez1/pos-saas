package io.github.mauriciotorrez1.pos.security;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.mauriciotorrez1.pos.core.identity.Role;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Register enrollment (F0-15): a code that works once, expires, and trades for a device token. */
class RegisterEnrollmentTest extends SecuredApiTest {

    private final JsonMapper json = JsonMapper.builder().build();
    private UUID tenant;
    private UUID branch;
    private Actor owner;
    private Actor manager;
    private Actor cashier;

    @BeforeAll
    void seed() {
        tenant = seedTenant();
        branch = admin.queryForObject("SELECT id FROM branch WHERE tenant_id = ?", UUID.class, tenant);
        owner = seedActor(tenant, Role.OWNER, true);
        manager = seedActor(tenant, Role.MANAGER, true);
        cashier = seedActor(tenant, Role.CASHIER, true);
    }

    private JsonNode issue(Actor caller, String registerCode) {
        Reply reply = call(caller, HttpMethod.POST, "/registers/enrollment-codes",
                "{\"branchId\": \"" + branch + "\", \"registerCode\": \"" + registerCode + "\", \"registerName\": \"Counter\"}");
        assertThat(reply.status()).as(reply.body()).isEqualTo(201);
        return json.readTree(reply.body());
    }

    private Reply enroll(UUID tenantId, String code) {
        return call(null, HttpMethod.POST, "/registers/enroll", "{\"tenantId\": \"" + tenantId + "\", \"code\": \"" + code + "\"}");
    }

    private String uniqueCode() {
        return "R" + Long.toString(Math.abs(UUID.randomUUID().getMostSignificantBits()), 36).toUpperCase().substring(0, 6);
    }

    @Test
    void enrollingCreatesTheRegisterBoundToTheBranchAndGivesAToken() {
        String registerCode = uniqueCode();
        JsonNode issued = issue(owner, registerCode);
        String code = issued.get("code").asString();
        assertThat(code).matches("[0-9A-Z]{4}(-[0-9A-Z]{4}){3}");

        Reply reply = enroll(tenant, code);

        assertThat(reply.status()).isEqualTo(201);
        assertThat(reply.headers().getFirst("Cache-Control")).contains("no-store");
        JsonNode body = json.readTree(reply.body());
        UUID registerId = UUID.fromString(body.get("registerId").asString());
        assertThat(body.get("registerCode").asString()).isEqualTo(registerCode);
        assertThat(body.get("deviceToken").asString()).hasSizeGreaterThanOrEqualTo(40);
        var register = admin.queryForMap("SELECT tenant_id, branch_id, code FROM register WHERE id = ?", registerId);
        assertThat(register.get("tenant_id")).isEqualTo(tenant);
        assertThat(register.get("branch_id")).isEqualTo(branch);
        assertThat(admin.queryForObject("SELECT register_id FROM enrollment_code WHERE id = ?", UUID.class,
                UUID.fromString(issued.get("id").asString()))).isEqualTo(registerId);
    }

    @Test
    void onlyHashesOfTheCodeAndTheTokenAreStored() {
        JsonNode issued = issue(owner, uniqueCode());
        String code = issued.get("code").asString();
        String token = json.readTree(enroll(tenant, code).body()).get("deviceToken").asString();

        String storedCodeHash = admin.queryForObject("SELECT code_hash FROM enrollment_code WHERE id = ?", String.class,
                UUID.fromString(issued.get("id").asString()));
        String storedTokenHash = admin.queryForObject("SELECT token_hash FROM register_device WHERE tenant_id = ? ORDER BY enrolled_at DESC LIMIT 1",
                String.class, tenant);
        assertThat(storedCodeHash).matches("[0-9a-f]{64}").doesNotContain(code.replace("-", ""));
        assertThat(storedTokenHash).matches("[0-9a-f]{64}").isNotEqualTo(token);
        String audit = admin.queryForObject("SELECT coalesce(string_agg(new_value::text, ' '), '') FROM audit_log WHERE tenant_id = ?", String.class, tenant);
        assertThat(audit).doesNotContain(code).doesNotContain(token);
    }

    @Test
    void aCodeWorksOnlyOnce() {
        String code = issue(manager, uniqueCode()).get("code").asString();

        assertThat(enroll(tenant, code).status()).isEqualTo(201);
        assertThat(enroll(tenant, code).status()).isEqualTo(400);
    }

    @Test
    void twoSimultaneousRequestsWithTheSameCodeEnrollOnlyOne() throws Exception {
        String code = issue(owner, uniqueCode()).get("code").asString();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Callable<Integer> attempt = () -> enroll(tenant, code).status();
            Future<Integer> first = pool.submit(attempt);
            Future<Integer> second = pool.submit(attempt);

            assertThat(List.of(first.get(), second.get())).containsExactlyInAnyOrder(201, 400);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void anExpiredCodeIsRejectedAndNeverCreatesARegister() {
        String registerCode = uniqueCode();
        String code = issue(owner, registerCode).get("code").asString();

        clock.advance(Duration.ofMinutes(16));

        assertThat(enroll(tenant, code).status()).isEqualTo(400);
        assertThat(admin.queryForObject("SELECT count(*) FROM register WHERE code = ?", Long.class, registerCode)).isZero();
    }

    @Test
    void wrongOrMalformedCodesAreAllRejectedTheSameWay() {
        String code = issue(owner, uniqueCode()).get("code").asString();

        assertThat(enroll(tenant, "AAAA-AAAA-AAAA-AAAA").status()).isEqualTo(400);
        assertThat(enroll(tenant, "short").status()).isEqualTo(400);
        assertThat(enroll(tenant, "").status()).isEqualTo(400);
        // The code of a business does not work with the id of another one.
        assertThat(enroll(seedTenant(), code).status()).isEqualTo(400);
        assertThat(call(null, HttpMethod.POST, "/registers/enroll", "{\"code\": \"" + code + "\"}").status()).isEqualTo(400);
        assertThat(enroll(tenant, code).status()).as("the code is still good for its own business").isEqualTo(201);
    }

    @Test
    void aCashierCannotIssueCodesAndTheAttemptIsAudited() {
        Reply reply = call(cashier, HttpMethod.POST, "/registers/enrollment-codes",
                "{\"branchId\": \"" + branch + "\", \"registerCode\": \"CX1\", \"registerName\": \"Counter\"}");

        assertThat(reply.status()).isEqualTo(403);
        assertThat(admin.queryForObject("""
                SELECT count(*) FROM audit_log WHERE actor_id = ? AND action = 'access.denied'
                AND new_value->>'permission' = 'register.enrollment.issue'
                """, Long.class, cashier.id())).isPositive();
    }

    @Test
    void aRegisterCodeAlreadyInUseIs409AndAnUnknownBranchIs404() {
        String registerCode = uniqueCode();
        enroll(tenant, issue(owner, registerCode).get("code").asString());

        assertThat(call(owner, HttpMethod.POST, "/registers/enrollment-codes",
                "{\"branchId\": \"" + branch + "\", \"registerCode\": \"" + registerCode + "\", \"registerName\": \"Again\"}").status()).isEqualTo(409);
        assertThat(call(owner, HttpMethod.POST, "/registers/enrollment-codes",
                "{\"branchId\": \"" + UUID.randomUUID() + "\", \"registerCode\": \"ZZ9\", \"registerName\": \"Lost\"}").status()).isEqualTo(404);
        assertThat(call(owner, HttpMethod.POST, "/registers/enrollment-codes",
                "{\"branchId\": \"" + branch + "\", \"registerCode\": \"bad code\", \"registerName\": \"Lost\"}").status()).isEqualTo(400);
    }

    @Test
    void aCodeIssuedTwiceForTheSameRegisterEnrollsOnlyTheFirstAndKeepsTheOtherUnspent() {
        String registerCode = uniqueCode();
        JsonNode first = issue(owner, registerCode);
        JsonNode second = issue(owner, registerCode);

        assertThat(enroll(tenant, first.get("code").asString()).status()).isEqualTo(201);
        assertThat(enroll(tenant, second.get("code").asString()).status()).isEqualTo(409);
        assertThat(admin.queryForObject("SELECT redeemed_at IS NULL FROM enrollment_code WHERE id = ?", Boolean.class,
                UUID.fromString(second.get("id").asString()))).isTrue();
    }

    @Test
    void theRegisterReceivesThePinHashesOfActiveUsersWithAPin() {
        Actor withPin = seedActor(tenant, Role.CASHIER, true);
        Actor withoutPin = seedActor(tenant, Role.CASHIER, true);
        Actor inactive = seedActor(tenant, Role.CASHIER, false);
        assertThat(status(owner, HttpMethod.PUT, "/users/" + withPin.id() + "/pin", "{\"pin\": \"2468\"}")).isEqualTo(204);
        admin.update("INSERT INTO user_pin (user_id, tenant_id, pin_hash) VALUES (?, ?, '$argon2id$v=19$m=19456,t=2,p=1$x$y')", inactive.id(), tenant);

        JsonNode body = json.readTree(enroll(tenant, issue(owner, uniqueCode()).get("code").asString()).body());

        List<String> ids = body.get("users").valueStream().map(user -> user.get("id").asString()).toList();
        assertThat(ids).contains(withPin.id().toString()).doesNotContain(withoutPin.id().toString(), inactive.id().toString());
        body.get("users").forEach(user -> assertThat(user.get("pinHash").asString()).startsWith("$argon2id$"));
    }

    @Test
    void enrollingIsAuditedWithoutSecrets() {
        String registerCode = uniqueCode();
        enroll(tenant, issue(owner, registerCode).get("code").asString());

        assertThat(admin.queryForObject("SELECT count(*) FROM audit_log WHERE tenant_id = ? AND action = 'register.enrolled' AND new_value->>'code' = ?",
                Long.class, tenant, registerCode)).isEqualTo(1);
    }
}
