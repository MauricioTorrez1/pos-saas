package io.github.mauriciotorrez1.pos.core.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import io.github.mauriciotorrez1.pos.core.CoreApplication;
import io.github.mauriciotorrez1.pos.db.PostgresTestConfiguration;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import io.github.mauriciotorrez1.pos.security.DeviceFixtures;
import io.github.mauriciotorrez1.pos.tenant.TenantContext;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
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
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.context.DynamicPropertyRegistrar;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * POST /sync/push stores the price changes of a register in an append-only log, audits them and announces them in
 * the same transaction, without ever rejecting one for what the core does not know yet (E1-40, ADR 0053). The
 * database is a real PostgreSQL, so the constraints, the row-level security and the transactions are the ones of
 * production.
 */
@SpringBootTest(classes = CoreApplication.class)
@AutoConfigureMockMvc
@Import({PostgresTestConfiguration.class, PriceChangeReceptionTest.WidePool.class})
class PriceChangeReceptionTest {

    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final String OCCURRED_AT = "2026-12-12T15:00:00.000Z";

    @Autowired
    private MockMvc mvc;

    @Autowired
    private JdbcTemplate app;

    @Autowired
    @Qualifier("adminJdbc")
    private JdbcTemplate admin;

    @Autowired
    private TransactionTemplate transaction;

    private final UUID tenant = Uuid7.next();
    private final UUID otherTenant = Uuid7.next();
    private final UUID register = Uuid7.next();
    private final UUID otherRegister = Uuid7.next();
    private final java.util.Map<UUID, String> credentials = new java.util.concurrent.ConcurrentHashMap<>();
    private final UUID product = Uuid7.next();
    private final UUID cashier = Uuid7.next();
    private final UUID owner = Uuid7.next();

    @Test
    void aPriceChangeIsStoredAuditedAndAnnouncedTogether() throws Exception {
        UUID changeId = Uuid7.next();

        JsonNode response = push(tenant, batch(change(Uuid7.next(), changeId, product, 1_160_000, 1_392_000)));

        assertThat(statuses(response)).containsExactly("accepted");
        Map<String, Object> row = admin.queryForMap("SELECT * FROM product_price_change WHERE tenant_id = ?", tenant);
        assertThat(row).containsEntry("id", changeId).containsEntry("product_id", product)
                .containsEntry("previous_unit_price_e4", 1_160_000L).containsEntry("new_unit_price_e4", 1_392_000L)
                .containsEntry("changed_by", cashier).containsEntry("authorized_by", owner)
                .containsEntry("register_id", register).containsEntry("discrepancy", false);
        Map<String, Object> audit = admin.queryForMap(
                "SELECT actor_id, action, entity_type, entity_id, old_value::text AS old_value, new_value::text AS new_value FROM audit_log WHERE tenant_id = ?",
                tenant);
        assertThat(audit).containsEntry("actor_id", cashier).containsEntry("action", "product.price_change")
                .containsEntry("entity_type", "product").containsEntry("entity_id", product);
        assertThat(audit.get("old_value").toString()).contains("1160000");
        assertThat(audit.get("new_value").toString()).contains("1392000").contains(owner.toString()).contains(changeId.toString());
        assertThat(events(changeId)).isOne();
        assertThat(admin.queryForObject("SELECT serialized_event FROM event_publication WHERE serialized_event LIKE ?", String.class,
                "%" + changeId + "%")).contains(tenant.toString()).contains(product.toString()).contains("\"schemaVersion\":1");
    }

    @Test
    void theSameOperationTwiceStoresOneChangeOneAuditEntryAndOneEvent() throws Exception {
        UUID changeId = Uuid7.next();
        ObjectNode operation = change(Uuid7.next(), changeId, product, 1_160_000, 1_392_000);

        assertThat(statuses(push(tenant, batch(operation)))).containsExactly("accepted");
        assertThat(statuses(push(tenant, batch(operation)))).containsExactly("duplicate");

        assertThat(count("product_price_change", tenant)).isOne();
        assertThat(count("audit_log", tenant)).isOne();
        assertThat(events(changeId)).isOne();
    }

    @Test
    void theSameChangeUnderAnotherOperationIsKeptApartAndNothingIsStoredTwice() throws Exception {
        UUID changeId = Uuid7.next();
        push(tenant, batch(change(Uuid7.next(), changeId, product, 1_160_000, 1_392_000)));

        JsonNode second = push(tenant, batch(change(Uuid7.next(), changeId, product, 1_160_000, 1_392_000)));

        assertThat(statuses(second)).containsExactly("quarantined");
        assertThat(second.get("results").get(0).get("reason").asString()).contains("already recorded");
        assertThat(count("product_price_change", tenant)).isOne();
        assertThat(count("audit_log", tenant)).isOne();
        assertThat(events(changeId)).isOne();
        assertThat(count("sync_operation", tenant)).isEqualTo(2);
    }

    @Test
    void manyThreadsSendingTheSameChangeStoreItOnce() throws Exception {
        UUID changeId = Uuid7.next();
        ObjectNode batch = batch(change(Uuid7.next(), changeId, product, 1_160_000, 1_392_000));

        List<String> results = concurrently(8, () -> statuses(push(tenant, batch)).get(0));

        assertThat(results.stream().filter("accepted"::equals)).hasSize(1);
        assertThat(results.stream().filter("duplicate"::equals)).hasSize(7);
        assertThat(count("product_price_change", tenant)).isOne();
        assertThat(count("audit_log", tenant)).isOne();
        assertThat(events(changeId)).isOne();
    }

    @Test
    void manyThreadsChangingTheSameProductEachCompareWithThePriceTheOtherLeft() throws Exception {
        // Eight changes that follow one another: 100 to 101, 101 to 102 and so on. Whatever order they get, the core
        // turns them one after the other, so at most one of them can be the first and none can compare with a price
        // that was not stored yet.
        List<ObjectNode> operations = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            operations.add(change(Uuid7.next(), Uuid7.next(), product, 1_000_000L + i * 10_000L, 1_000_000L + (i + 1) * 10_000L));
        }
        AtomicIndex next = new AtomicIndex();

        List<String> results = concurrently(8, () -> statuses(push(tenant, batch(operations.get(next.take())))).get(0));

        assertThat(results).containsOnly("accepted");
        assertThat(count("product_price_change", tenant)).isEqualTo(8);
        // The first stored has nothing to compare with. Each other one compares with the one stored just before it.
        List<Map<String, Object>> stored = admin.queryForList(
                "SELECT previous_unit_price_e4, server_price_e4, discrepancy FROM product_price_change WHERE tenant_id = ? ORDER BY seq", tenant);
        assertThat(stored.get(0).get("server_price_e4")).isNull();
        List<Long> newPrices = admin.queryForList("SELECT new_unit_price_e4 FROM product_price_change WHERE tenant_id = ? ORDER BY seq", Long.class, tenant);
        for (int i = 1; i < stored.size(); i++) {
            assertThat(stored.get(i).get("server_price_e4")).isEqualTo(newPrices.get(i - 1));
        }
    }

    @Test
    void aChangeOfAProductTheCoreDoesNotKnowYetIsKept() throws Exception {
        UUID unknown = Uuid7.next();

        JsonNode response = push(tenant, batch(change(Uuid7.next(), Uuid7.next(), unknown, 5_000, 6_000)));

        assertThat(statuses(response)).containsExactly("accepted");
        assertThat(admin.queryForObject("SELECT count(*) FROM product_price_change WHERE tenant_id = ? AND product_id = ?", Integer.class,
                tenant, unknown)).isOne();
    }

    @Test
    void aPreviousPriceThatIsNotTheOneOfTheCoreIsKeptAndMarkedAsADiscrepancy() throws Exception {
        push(tenant, batch(change(Uuid7.next(), Uuid7.next(), product, 1_000_000, 1_100_000)));

        JsonNode response = push(tenant, batch(change(Uuid7.next(), Uuid7.next(), product, 1_050_000, 1_200_000)));

        assertThat(statuses(response)).containsExactly("accepted");
        Map<String, Object> second = admin.queryForMap(
                "SELECT previous_unit_price_e4, server_price_e4, discrepancy FROM product_price_change WHERE tenant_id = ? ORDER BY seq DESC LIMIT 1", tenant);
        assertThat(second).containsEntry("discrepancy", true).containsEntry("server_price_e4", 1_100_000L)
                .containsEntry("previous_unit_price_e4", 1_050_000L);
        assertThat(admin.queryForObject("SELECT new_value::text FROM audit_log WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1", String.class,
                tenant)).contains("serverPriceE4");
        assertThat(admin.queryForObject("SELECT count(*) FROM product_price_change WHERE tenant_id = ? AND discrepancy", Integer.class, tenant)).isOne();
    }

    @Test
    void aMatchingPreviousPriceIsNotADiscrepancy() throws Exception {
        push(tenant, batch(change(Uuid7.next(), Uuid7.next(), product, 1_000_000, 1_100_000)));

        push(tenant, batch(change(Uuid7.next(), Uuid7.next(), product, 1_100_000, 1_200_000)));

        assertThat(admin.queryForObject("SELECT count(*) FROM product_price_change WHERE tenant_id = ? AND discrepancy", Integer.class, tenant)).isZero();
    }

    @Test
    void businessesNeverSeeEachOthersChangesAndTheSameIdsDoNotCollide() throws Exception {
        UUID changeId = Uuid7.next();
        push(tenant, batch(change(Uuid7.next(), changeId, product, 1_000_000, 1_100_000)));

        // Another business sends a change with the very same changeId and product: it is its own change.
        JsonNode other = push(otherTenant, batch(change(Uuid7.next(), changeId, product, 2_000_000, 2_100_000)));

        assertThat(statuses(other)).containsExactly("accepted");
        assertThat(seenByApplication(tenant)).isOne();
        assertThat(seenByApplication(otherTenant)).isOne();
        // And its previous price is compared only with its own history.
        assertThat(admin.queryForObject("SELECT count(*) FROM product_price_change WHERE tenant_id = ? AND discrepancy", Integer.class, otherTenant)).isZero();
        assertThat(admin.queryForObject("SELECT server_price_e4 FROM product_price_change WHERE tenant_id = ?", Long.class, otherTenant)).isNull();
    }

    @Test
    void ifTheAuditFailsTheWholeChangeIsUndoneAndNothingIsConfirmed() throws Exception {
        UUID changeId = Uuid7.next();
        String trigger = "break_audit_" + tenant.toString().replace("-", "");
        admin.execute("CREATE FUNCTION " + trigger + "() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit is down'; END $$");
        admin.execute("CREATE TRIGGER " + trigger + " BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.tenant_id = '" + tenant
                + "') EXECUTE FUNCTION " + trigger + "()");
        try {
            mvc.perform(post("/sync/push").with(token(tenant)).contentType(MediaType.APPLICATION_JSON)
                    .content(batch(change(Uuid7.next(), changeId, product, 1_160_000, 1_392_000)).toString()))
                    .andExpect(status().isServiceUnavailable());
        } finally {
            admin.execute("DROP TRIGGER " + trigger + " ON audit_log");
            admin.execute("DROP FUNCTION " + trigger + "()");
        }

        assertThat(count("product_price_change", tenant)).isZero();
        assertThat(count("sync_operation", tenant)).isZero();
        assertThat(count("audit_log", tenant)).isZero();
        assertThat(events(changeId)).isZero();
        // The register sends it again once the audit works, and it is stored.
        assertThat(statuses(push(tenant, batch(change(Uuid7.next(), changeId, product, 1_160_000, 1_392_000))))).containsExactly("accepted");
    }

    @Test
    void theLogCannotBeEditedOrDeleted() throws Exception {
        push(tenant, batch(change(Uuid7.next(), Uuid7.next(), product, 1_000_000, 1_100_000)));

        for (String statement : List.of("UPDATE product_price_change SET new_unit_price_e4 = 1", "DELETE FROM product_price_change")) {
            try {
                admin.update(statement);
                throw new AssertionError("The log accepted: " + statement);
            } catch (org.springframework.dao.DataAccessException expected) {
                assertThat(expected.getMostSpecificCause().getMessage()).contains("append-only");
            }
        }
        assertThat(count("product_price_change", tenant)).isOne();
    }

    @Test
    void aPriceOfZeroOrTheSamePriceIsRefusedByTheContractAndKeptForReview() throws Exception {
        ObjectNode zero = change(Uuid7.next(), Uuid7.next(), product, 1_000_000, 0);

        JsonNode response = push(tenant, batch(zero));

        assertThat(statuses(response)).containsExactly("quarantined");
        assertThat(count("product_price_change", tenant)).isZero();
        assertThat(count("sync_operation", tenant)).isOne();
    }

    @Test
    void theChangesOfTheContractCasesOfTheRegisterAreAccepted() throws Exception {
        JsonNode cases = read("/contracts/cases/sync-push.json");
        int pushed = 0;
        for (JsonNode example : cases.get("requests")) {
            JsonNode request = example.get("request");
            if (!example.get("name").asString().contains("price change")) {
                continue;
            }
            // Fresh ids per run: the cases use fixed ones, and a business only stores each once.
            ObjectNode copy = (ObjectNode) request.deepCopy();
            copy.put("registerId", register.toString());
            for (JsonNode operation : copy.get("operations")) {
                ((ObjectNode) operation).put("opId", Uuid7.next().toString());
                ((ObjectNode) operation.get("payload")).put("changeId", Uuid7.next().toString());
            }
            JsonNode response = push(tenant, copy);
            assertThat(statuses(response)).as(example.get("name").asString()).containsOnly("accepted");
            pushed += copy.get("operations").size();
        }
        assertThat(pushed).as("price change cases in the contract").isGreaterThanOrEqualTo(2);
        assertThat(count("product_price_change", tenant)).isEqualTo(pushed);
    }

    // helpers -------------------------------------------------------------------------------------------------

    private ObjectNode change(UUID opId, UUID changeId, UUID productId, long previous, long current) {
        ObjectNode payload = JSON.createObjectNode();
        payload.put("changeId", changeId.toString());
        payload.put("productId", productId.toString());
        payload.put("previousUnitPriceE4", previous);
        payload.put("newUnitPriceE4", current);
        payload.put("changedBy", cashier.toString());
        payload.put("authorizedBy", owner.toString());
        ObjectNode operation = JSON.createObjectNode();
        operation.put("opId", opId.toString());
        operation.put("deviceSeq", 1);
        operation.put("type", "product.price_changed");
        operation.put("schemaVersion", 1);
        operation.put("occurredAt", OCCURRED_AT);
        operation.set("payload", payload);
        return operation;
    }

    private ObjectNode batch(ObjectNode... operations) {
        ObjectNode batch = JSON.createObjectNode();
        batch.put("registerId", register.toString());
        ArrayNode array = batch.putArray("operations");
        for (ObjectNode operation : operations) {
            array.add(operation);
        }
        return batch;
    }

    private JsonNode push(UUID business, ObjectNode batch) throws Exception {
        // A register sends batches that name itself, so the batch of another business names its own register.
        batch.put("registerId", registerOf(business).toString());
        String body = mvc.perform(post("/sync/push").with(token(business)).contentType(MediaType.APPLICATION_JSON).content(batch.toString()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return JSON.readTree(body);
    }

    private UUID registerOf(UUID business) {
        return business.equals(tenant) ? register : otherRegister;
    }

    /** The device credential of the register of the business, enrolled on first use (ADR 0054). */
    private RequestPostProcessor token(UUID business) {
        return DeviceFixtures.device(credentials.computeIfAbsent(business, id -> DeviceFixtures.enroll(admin, id, registerOf(id))));
    }

    private static List<String> statuses(JsonNode response) {
        List<String> statuses = new ArrayList<>();
        response.get("results").forEach(result -> statuses.add(result.get("status").asString()));
        return statuses;
    }

    private int count(String table, UUID business) {
        return admin.queryForObject("SELECT count(*) FROM " + table + " WHERE tenant_id = ?", Integer.class, business);
    }

    private int events(UUID changeId) {
        return admin.queryForObject("SELECT count(*) FROM event_publication WHERE serialized_event LIKE ?", Integer.class, "%" + changeId + "%");
    }

    /** Counts through the application role, so row-level security decides what is visible. */
    private int seenByApplication(UUID business) {
        return TenantContext.callAs(business, () -> transaction.execute(
                status -> app.queryForObject("SELECT count(*) FROM product_price_change", Integer.class)));
    }

    private static <T> List<T> concurrently(int threads, java.util.concurrent.Callable<T> work) throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        try {
            CountDownLatch start = new CountDownLatch(1);
            List<Future<T>> runs = new ArrayList<>();
            for (int i = 0; i < threads; i++) {
                runs.add(pool.submit(() -> {
                    start.await();
                    return work.call();
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

    private static JsonNode read(String resource) throws IOException {
        try (InputStream cases = PriceChangeReceptionTest.class.getResourceAsStream(resource)) {
            return JSON.readTree(Objects.requireNonNull(cases, resource));
        }
    }

    /** Hands each thread its own change. */
    private static final class AtomicIndex {
        private final java.util.concurrent.atomic.AtomicInteger value = new java.util.concurrent.atomic.AtomicInteger();

        int take() {
            return value.getAndIncrement();
        }
    }

    /** A pool wide enough for real concurrency: the shared test pool has one connection. */
    @TestConfiguration(proxyBeanMethods = false)
    static class WidePool {

        @Bean
        DynamicPropertyRegistrar widePool() {
            return registry -> registry.add("spring.datasource.hikari.maximum-pool-size", () -> 12);
        }
    }
}
