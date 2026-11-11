package io.github.mauriciotorrez1.pos.core.sync;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.github.mauriciotorrez1.pos.core.CoreApplication;
import io.github.mauriciotorrez1.pos.db.PostgresTestConfiguration;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.DynamicPropertyRegistrar;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * The review of what the core could not apply (RF-022, E1-19, ADR 0055): listing, detail, and the three ways to
 * resolve, each idempotent, final, audited in the same transaction and announced to the register through the pull.
 * The database is a real PostgreSQL, so the lock, the unique constraint, row-level security and the transactions are
 * the ones of production.
 */
@SpringBootTest(classes = CoreApplication.class)
@AutoConfigureMockMvc
@Import({PostgresTestConfiguration.class, ReviewTest.WidePool.class})
class ReviewTest {

    private static final JsonMapper JSON = JsonMapper.builder().build();

    @Autowired
    private MockMvc mvc;

    @Autowired
    @Qualifier("adminJdbc")
    private JdbcTemplate admin;

    private final UUID tenant = Uuid7.next();
    private final UUID otherTenant = Uuid7.next();
    private final UUID register = Uuid7.next();
    private final Map<String, UUID> users = new java.util.HashMap<>();

    // listing and detail --------------------------------------------------------------------------------------------

    @Test
    void aQuarantinedSaleIsListedWithItsReasonAndShownExactlyAsItArrived() throws Exception {
        UUID opId = quarantineSale();

        JsonNode list = getJson("/quarantine", token(tenant, "manager"));
        JsonNode detail = getJson("/quarantine/" + opId, token(tenant, "owner"));

        assertThat(list.get("items")).hasSize(1);
        assertThat(list.get("items").get(0).get("opId").asString()).isEqualTo(opId.toString());
        assertThat(list.get("items").get(0).get("status").asString()).isEqualTo("open");
        assertThat(list.get("items").get(0).get("reason").asString()).isNotBlank();
        assertThat(list.get("items").get(0).has("operation")).as("the list stays light").isFalse();
        assertThat(detail.get("operation").get("payload").get("totalCents").asLong()).isZero();
        assertThat(detail.get("operation").get("opId").asString()).isEqualTo(opId.toString());
    }

    @Test
    void theListIsPagedByACursorAndFiltersByStatus() throws Exception {
        UUID first = quarantineSale();
        UUID second = quarantineSale();
        UUID third = quarantineSale();
        resolve("/quarantine/" + first + "/resolution", "manager", "{\"action\":\"reject\",\"reason\":\"Test sale\"}").andExpect(status().isCreated());

        List<String> seen = new ArrayList<>();
        String cursor = null;
        do {
            JsonNode page = getJson("/quarantine?limit=1" + (cursor == null ? "" : "&cursor=" + cursor), token(tenant, "manager"));
            assertThat(page.get("items")).hasSize(1);
            seen.add(page.get("items").get(0).get("opId").asString());
            cursor = page.has("nextCursor") ? page.get("nextCursor").asString() : null;
        } while (cursor != null);
        JsonNode resolved = getJson("/quarantine?status=resolved", token(tenant, "manager"));
        JsonNode all = getJson("/quarantine?status=all", token(tenant, "manager"));

        assertThat(seen).as("every open item once, whatever the order of the ids").containsExactlyInAnyOrder(second.toString(), third.toString());
        assertThat(resolved.get("items")).hasSize(1);
        assertThat(resolved.get("items").get(0).get("status").asString()).isEqualTo("rejected");
        assertThat(all.get("items")).hasSize(3);
        mvc.perform(get("/quarantine?limit=101").with(token(tenant, "manager"))).andExpect(status().isBadRequest());
        mvc.perform(get("/quarantine?status=whatever").with(token(tenant, "manager"))).andExpect(status().isBadRequest());
    }

    @Test
    void aPriceThatDoesNotMatchTheOneOfTheCoreIsListedAsADiscrepancy() throws Exception {
        UUID change = discrepancy();

        JsonNode list = getJson("/discrepancies", token(tenant, "manager"));
        JsonNode detail = getJson("/discrepancies/" + change, token(tenant, "owner"));

        assertThat(list.get("items")).hasSize(1);
        assertThat(detail.get("previousUnitPriceE4").asLong()).isEqualTo(100);
        assertThat(detail.get("serverPriceE4").asLong()).isEqualTo(200);
        assertThat(detail.get("newUnitPriceE4").asLong()).isEqualTo(300);
        assertThat(detail.get("status").asString()).isEqualTo("open");
    }

    // resolving -----------------------------------------------------------------------------------------------------

    @Test
    void acceptingAnOperationThatCanBeAppliedStoresItThroughTheSameRecorderOnceAndAuditsIt() throws Exception {
        UUID opId = storeQuarantined(SyncFixtures.sale(Uuid7.next()), "The core was not ready");

        resolve("/quarantine/" + opId + "/resolution", "manager", "{\"action\":\"accept\"}")
                .andExpect(status().isCreated());

        assertThat(count("sale")).isOne();
        assertThat(count("sale_line")).isOne();
        assertThat(count("review_resolution")).isOne();
        Map<String, Object> audit = admin.queryForMap("SELECT actor_id, action, entity_type, new_value::text AS new_value FROM audit_log WHERE entity_id = ?", opId);
        assertThat(audit.get("actor_id")).isEqualTo(users.get("manager"));
        assertThat(audit.get("action")).isEqualTo("review.resolved");
        assertThat(audit.get("new_value").toString()).contains("accepted");
        assertThat(getJson("/quarantine/" + opId, token(tenant, "owner")).get("status").asString()).isEqualTo("accepted");
    }

    @Test
    void acceptingAnOperationThatStillBreaksARuleChangesNothingAndSaysWhy() throws Exception {
        UUID opId = quarantineSale();

        String body = resolve("/quarantine/" + opId + "/resolution", "owner", "{\"action\":\"accept\"}")
                .andExpect(status().isUnprocessableContent()).andReturn().getResponse().getContentAsString();

        assertThat(body).contains("cannot be applied");
        assertThat(count("sale")).isZero();
        assertThat(count("review_resolution")).as("no resolution without its effect").isZero();
        assertThat(count("audit_log")).isZero();
        assertThat(count("sync_change")).isZero();
        assertThat(getJson("/quarantine/" + opId, token(tenant, "owner")).get("status").asString()).isEqualTo("open");
    }

    @Test
    void correctingAnOperationAppliesTheNewPayloadUnderTheSameOpIdAndKeepsTheOriginal() throws Exception {
        UUID opId = quarantineSale();
        JsonNode fixed = SyncFixtures.sale(Uuid7.next()).get("payload");
        ObjectNode request = JSON.createObjectNode();
        request.put("action", "correct");
        request.put("reason", "The total was zero by mistake");
        request.set("correctedPayload", fixed);

        resolve("/quarantine/" + opId + "/resolution", "owner", request.toString()).andExpect(status().isCreated());

        assertThat(admin.queryForObject("SELECT op_id FROM sale WHERE tenant_id = ?", UUID.class, tenant)).isEqualTo(opId);
        JsonNode detail = getJson("/quarantine/" + opId, token(tenant, "owner"));
        assertThat(detail.get("status").asString()).isEqualTo("corrected");
        assertThat(detail.get("operation").get("payload").get("totalCents").asLong()).as("the original is kept").isZero();
        assertThat(detail.get("resolution").get("reason").asString()).isEqualTo("The total was zero by mistake");
    }

    @Test
    void rejectingNeedsAReasonStoresNothingAndIsRecordedWithWhoAndWhen() throws Exception {
        UUID opId = quarantineSale();

        resolve("/quarantine/" + opId + "/resolution", "manager", "{\"action\":\"reject\"}").andExpect(status().isBadRequest());
        resolve("/quarantine/" + opId + "/resolution", "manager", "{\"action\":\"reject\",\"reason\":\"  \"}").andExpect(status().isBadRequest());
        resolve("/quarantine/" + opId + "/resolution", "manager", "{\"action\":\"correct\",\"reason\":\"x\"}").andExpect(status().isBadRequest());
        resolve("/quarantine/" + opId + "/resolution", "manager", "{\"action\":\"explode\"}").andExpect(status().isBadRequest());
        resolve("/quarantine/" + opId + "/resolution", "manager", "{\"action\":\"reject\",\"reason\":\"Duplicated ticket of Juan Perez\"}")
                .andExpect(status().isCreated());

        assertThat(count("sale")).isZero();
        Map<String, Object> row = admin.queryForMap("SELECT action, reason, resolved_by FROM review_resolution WHERE subject_id = ?", opId);
        assertThat(row.get("action")).isEqualTo("rejected");
        assertThat(row.get("resolved_by")).isEqualTo(users.get("manager"));
        String audit = admin.queryForObject("SELECT old_value::text || new_value::text FROM audit_log WHERE entity_id = ?", String.class, opId);
        assertThat(audit).as("the free text of the owner never reaches the audit log").doesNotContain("Juan");
    }

    @Test
    void aResolutionIsFinalButRepeatingTheSameOneIsHarmless() throws Exception {
        UUID opId = quarantineSale();
        String reject = "{\"action\":\"reject\",\"reason\":\"Duplicated ticket\"}";

        resolve("/quarantine/" + opId + "/resolution", "manager", reject).andExpect(status().isCreated());
        resolve("/quarantine/" + opId + "/resolution", "owner", reject).andExpect(status().isOk());
        resolve("/quarantine/" + opId + "/resolution", "owner", "{\"action\":\"accept\"}").andExpect(status().isConflict());

        assertThat(count("review_resolution")).isOne();
        assertThat(count("audit_log")).as("the repeat wrote nothing").isOne();
        assertThat(count("sync_change")).isOne();
    }

    @Test
    void twoPeopleResolvingTheSameItemAtOnceApplyItOnceAndOnlyOneWins() throws Exception {
        UUID opId = storeQuarantined(SyncFixtures.sale(Uuid7.next()), "The core was not ready");
        JwtRequestPostProcessor manager = token(tenant, "manager");
        JwtRequestPostProcessor owner = token(tenant, "owner");

        List<Integer> sameAction = concurrently(
                () -> statusOf("/quarantine/" + opId + "/resolution", manager, "{\"action\":\"accept\"}"),
                () -> statusOf("/quarantine/" + opId + "/resolution", owner, "{\"action\":\"accept\"}"),
                () -> statusOf("/quarantine/" + opId + "/resolution", owner, "{\"action\":\"accept\"}"));

        assertThat(sameAction).containsExactlyInAnyOrder(201, 200, 200);
        assertThat(count("sale")).isOne();
        assertThat(count("review_resolution")).isOne();
        assertThat(count("audit_log")).isOne();
        assertThat(count("sync_change")).isOne();

        UUID other = quarantineSale();
        List<Integer> opposite = concurrently(
                () -> statusOf("/quarantine/" + other + "/resolution", manager, "{\"action\":\"reject\",\"reason\":\"No\"}"),
                () -> statusOf("/quarantine/" + other + "/resolution", owner, "{\"action\":\"accept\"}"));

        assertThat(opposite).as("accepting a sale that cannot be applied fails too").containsAnyOf(201, 422).doesNotContain(500);
        assertThat(admin.queryForObject("SELECT count(*) FROM review_resolution WHERE subject_id = ?", Integer.class, other)).isLessThanOrEqualTo(1);
    }

    @Test
    void aPriceDiscrepancyIsAcceptedOrRejectedButNeverCorrected() throws Exception {
        UUID accepted = discrepancy();
        UUID rejected = discrepancy();

        resolve("/discrepancies/" + accepted + "/resolution", "manager", "{\"action\":\"accept\"}").andExpect(status().isCreated());
        resolve("/discrepancies/" + rejected + "/resolution", "owner", "{\"action\":\"reject\",\"reason\":\"Charged by mistake\"}").andExpect(status().isCreated());
        resolve("/discrepancies/" + rejected + "/resolution", "owner", "{\"action\":\"correct\",\"reason\":\"x\",\"correctedPayload\":{}}").andExpect(status().isBadRequest());

        assertThat(getJson("/discrepancies/" + accepted, token(tenant, "owner")).get("status").asString()).isEqualTo("accepted");
        assertThat(getJson("/discrepancies/" + rejected, token(tenant, "owner")).get("resolution").get("reason").asString()).isEqualTo("Charged by mistake");
        assertThat(getJson("/discrepancies", token(tenant, "owner")).get("items")).isEmpty();
        assertThat(count("product_price_change")).as("the price log is never edited").isEqualTo(4);
    }

    // the register hears about it, the business is respected --------------------------------------------------------

    @Test
    void theRegisterLearnsTheDecisionThroughThePullWithTheReasonAndNoOtherBusinessSeesIt() throws Exception {
        UUID opId = quarantineSale();
        resolve("/quarantine/" + opId + "/resolution", "manager", "{\"action\":\"reject\",\"reason\":\"Duplicated ticket\"}").andExpect(status().isCreated());

        JsonNode mine = getJson("/sync/pull", token(tenant, "cashier"));
        JsonNode theirs = getJson("/sync/pull", token(otherTenant, "cashier"));

        JsonNode notice = mine.get("changes").get(0);
        assertThat(notice.get("entityType").asString()).isEqualTo("review_resolution");
        assertThat(notice.get("entityId").asString()).isEqualTo(opId.toString());
        assertThat(notice.get("payload").get("resolution").asString()).isEqualTo("rejected");
        assertThat(notice.get("payload").get("reason").asString()).isEqualTo("Duplicated ticket");
        assertThat(notice.get("payload").get("operationType").asString()).isEqualTo("sale.completed");
        assertThat(theirs.get("changes")).isEmpty();
    }

    @Test
    void anotherBusinessSeesNothingAndCannotResolveWhatIsNotItsOwn() throws Exception {
        UUID opId = quarantineSale();
        UUID change = discrepancy();
        token(otherTenant, "owner");

        assertThat(getJson("/quarantine", token(otherTenant, "owner")).get("items")).isEmpty();
        assertThat(getJson("/discrepancies", token(otherTenant, "owner")).get("items")).isEmpty();
        mvc.perform(get("/quarantine/" + opId).with(token(otherTenant, "owner"))).andExpect(status().isNotFound());
        resolve("/quarantine/" + opId + "/resolution", otherTenant, "owner", "{\"action\":\"reject\",\"reason\":\"Mine now\"}").andExpect(status().isNotFound());
        resolve("/discrepancies/" + change + "/resolution", otherTenant, "owner", "{\"action\":\"accept\"}").andExpect(status().isNotFound());

        assertThat(getJson("/quarantine", token(tenant, "owner")).get("items")).hasSize(1);
        assertThat(count("review_resolution")).isZero();
    }

    @Test
    void theCashierCannotSeeOrResolveAndTheManagerAndTheOwnerCan() throws Exception {
        UUID opId = quarantineSale();

        mvc.perform(get("/quarantine").with(token(tenant, "cashier"))).andExpect(status().isForbidden());
        mvc.perform(get("/discrepancies").with(token(tenant, "cashier"))).andExpect(status().isForbidden());
        resolve("/quarantine/" + opId + "/resolution", "cashier", "{\"action\":\"reject\",\"reason\":\"x\"}").andExpect(status().isForbidden());
        mvc.perform(get("/quarantine").with(token(tenant, "manager"))).andExpect(status().isOk());
        mvc.perform(get("/quarantine").with(token(tenant, "owner"))).andExpect(status().isOk());

        assertThat(count("review_resolution")).isZero();
    }

    @Test
    void aResolutionRowCannotBeEditedOrRemovedEvenByTheOwnerOfTheTable() throws Exception {
        UUID opId = quarantineSale();
        resolve("/quarantine/" + opId + "/resolution", "owner", "{\"action\":\"reject\",\"reason\":\"No\"}").andExpect(status().isCreated());

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> admin.update("UPDATE review_resolution SET action = 'accepted' WHERE tenant_id = ?", tenant))
                .rootCause().hasMessageContaining("append-only");
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> admin.update("DELETE FROM review_resolution WHERE tenant_id = ?", tenant))
                .rootCause().hasMessageContaining("append-only");
    }

    // helpers -------------------------------------------------------------------------------------------------------

    /** Sends a sale whose total is zero, which the core keeps in quarantine, and returns its opId. */
    private UUID quarantineSale() throws Exception {
        UUID opId = Uuid7.next();
        ObjectNode sale = SyncFixtures.sale(opId);
        ((ObjectNode) sale.get("payload")).put("totalCents", 0);
        String body = mvc.perform(post("/sync/push").with(token(tenant, "cashier")).contentType(MediaType.APPLICATION_JSON)
                        .content(SyncFixtures.batch(register, sale).toString()))
                .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
        assertThat(JSON.readTree(body).get("results").get(0).get("status").asString()).isEqualTo("quarantined");
        return opId;
    }

    /** Keeps an operation that is valid in quarantine, as if the core had not been able to apply it when it arrived. */
    private UUID storeQuarantined(ObjectNode operation, String reason) {
        token(tenant, "cashier");
        UUID opId = UUID.fromString(operation.get("opId").asString());
        admin.update("""
                INSERT INTO sync_operation (id, tenant_id, op_id, register_id, device_seq, type, schema_version, occurred_at, status, reason, raw_operation)
                VALUES (?, ?, ?, ?, 1, 'sale.completed', 1, now(), 'quarantined', ?, ?::jsonb)""",
                Uuid7.next(), tenant, opId, register, reason, operation.toString());
        return opId;
    }

    /** Sends two price changes of one product; the second one says it changed from a price the core does not hold. */
    private UUID discrepancy() throws Exception {
        UUID product = Uuid7.next();
        push(change(Uuid7.next(), Uuid7.next(), product, 100, 200));
        UUID change = Uuid7.next();
        push(change(Uuid7.next(), change, product, 100, 300));
        return change;
    }

    private void push(ObjectNode operation) throws Exception {
        mvc.perform(post("/sync/push").with(token(tenant, "cashier")).contentType(MediaType.APPLICATION_JSON)
                        .content(SyncFixtures.batch(register, operation).toString()))
                .andExpect(status().isOk());
    }

    private ObjectNode change(UUID opId, UUID changeId, UUID productId, long previous, long current) {
        ObjectNode payload = JSON.createObjectNode();
        payload.put("changeId", changeId.toString());
        payload.put("productId", productId.toString());
        payload.put("previousUnitPriceE4", previous);
        payload.put("newUnitPriceE4", current);
        payload.put("changedBy", Uuid7.next().toString());
        payload.put("authorizedBy", Uuid7.next().toString());
        return SyncFixtures.operation(opId, "product.price_changed", payload);
    }

    private org.springframework.test.web.servlet.ResultActions resolve(String path, String role, String body) throws Exception {
        return resolve(path, tenant, role, body);
    }

    private org.springframework.test.web.servlet.ResultActions resolve(String path, UUID business, String role, String body) throws Exception {
        return mvc.perform(post(path).with(token(business, role)).contentType(MediaType.APPLICATION_JSON).content(body));
    }

    private int statusOf(String path, JwtRequestPostProcessor token, String body) throws Exception {
        return mvc.perform(post(path).with(token).contentType(MediaType.APPLICATION_JSON).content(body)).andReturn().getResponse().getStatus();
    }

    private JsonNode getJson(String path, JwtRequestPostProcessor token) throws Exception {
        return JSON.readTree(mvc.perform(get(path).with(token)).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
    }

    @SafeVarargs
    private static <T> List<T> concurrently(Callable<T>... work) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(work.length);
        try {
            CountDownLatch start = new CountDownLatch(1);
            List<Future<T>> runs = new ArrayList<>();
            for (Callable<T> call : work) {
                runs.add(pool.submit(() -> {
                    start.await();
                    return call.call();
                }));
            }
            start.countDown();
            List<T> results = new ArrayList<>();
            for (Future<T> run : runs) {
                results.add(run.get(60, TimeUnit.SECONDS));
            }
            return results;
        } finally {
            pool.shutdownNow();
        }
    }

    private int count(String table) {
        return admin.queryForObject("SELECT count(*) FROM " + table + " WHERE tenant_id = ?", Integer.class, tenant);
    }

    private JwtRequestPostProcessor token(UUID business, String role) {
        String subject = role + "-" + business;
        admin.update("INSERT INTO tenant (id, name) VALUES (?, 'Test business') ON CONFLICT DO NOTHING", business);
        UUID id = users.computeIfAbsent(role + business, key -> Uuid7.next());
        admin.update("""
                INSERT INTO app_user (id, tenant_id, display_name, role, keycloak_subject)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING""", id, business, role, role, subject);
        if (business.equals(tenant)) {
            users.put(role, id);
        }
        return jwt().jwt(token -> token.subject(subject).claim("tenant_id", business.toString()));
    }

    /** A pool wide enough for real concurrency (the shared test pool has one connection). */
    @TestConfiguration(proxyBeanMethods = false)
    static class WidePool {

        @Bean
        DynamicPropertyRegistrar widePool() {
            return registry -> registry.add("spring.datasource.hikari.maximum-pool-size", () -> 16);
        }
    }
}
