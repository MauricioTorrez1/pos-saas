package io.github.mauriciotorrez1.pos.core.sync;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.networknt.schema.Schema;
import com.networknt.schema.SchemaLocation;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SpecificationVersion;
import io.github.mauriciotorrez1.pos.core.CoreApplication;
import io.github.mauriciotorrez1.pos.db.PostgresTestConfiguration;
import io.github.mauriciotorrez1.pos.feed.ChangePublisher;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import io.github.mauriciotorrez1.pos.security.DeviceFixtures;
import io.github.mauriciotorrez1.pos.tenant.TenantContext;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.request.RequestPostProcessor;
import org.springframework.test.context.DynamicPropertyRegistrar;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * GET /sync/pull gives a register what changed since its cursor (RF-023, E1-18). The database is a real
 * PostgreSQL, so the numbering lock, row-level security and the transactions are the ones of production.
 * The owner modules that publish products are not built yet (F0-16), so the tests publish through the same
 * {@link ChangePublisher} that they will use.
 */
@SpringBootTest(classes = CoreApplication.class)
@AutoConfigureMockMvc
@Import({PostgresTestConfiguration.class, SyncPullTest.WidePool.class})
class SyncPullTest {

    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final Schema RESPONSE_SCHEMA = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12)
            .getSchema(SchemaLocation.of("classpath:contracts/schemas/sync-pull-response.schema.json"));
    private static final JsonNode CASES = readCases();

    @Autowired
    private MockMvc mvc;

    @Autowired
    private ChangePublisher publisher;

    @Autowired
    private TransactionTemplate transaction;

    @Autowired
    @Qualifier("adminJdbc")
    private JdbcTemplate admin;

    private final UUID tenant = Uuid7.next();
    private final UUID otherTenant = Uuid7.next();
    private final java.util.Map<UUID, String> credentials = new java.util.concurrent.ConcurrentHashMap<>();

    @Test
    void aBusinessWithNoChangesGetsAnEmptyPageAndKeepsItsCursor() throws Exception {
        JsonNode first = pull(tenant, "");
        JsonNode resumed = pull(tenant, "cursor=0");

        assertThat(first.get("changes")).isEmpty();
        assertThat(first.get("nextCursor").asString()).isEqualTo("0");
        assertThat(first.get("hasMore").asBoolean()).isFalse();
        assertThat(resumed).isEqualTo(first);
        assertThat(RESPONSE_SCHEMA.validate(first)).isEmpty();
    }

    @Test
    void changesComeInOrderInPagesAndTheLastPageSaysThereIsNoMore() throws Exception {
        List<UUID> products = publishProducts(tenant, 5);

        JsonNode page1 = pull(tenant, "limit=2");
        JsonNode page2 = pull(tenant, "cursor=" + page1.get("nextCursor").asString() + "&limit=2");
        JsonNode page3 = pull(tenant, "cursor=" + page2.get("nextCursor").asString() + "&limit=2");
        JsonNode page4 = pull(tenant, "cursor=" + page3.get("nextCursor").asString() + "&limit=2");

        assertThat(seqs(page1)).containsExactly(1L, 2L);
        assertThat(page1.get("hasMore").asBoolean()).isTrue();
        assertThat(page1.get("nextCursor").asString()).isEqualTo("2");
        assertThat(seqs(page2)).containsExactly(3L, 4L);
        assertThat(page2.get("hasMore").asBoolean()).isTrue();
        assertThat(seqs(page3)).containsExactly(5L);
        assertThat(page3.get("hasMore").asBoolean()).isFalse();
        assertThat(page4.get("changes")).isEmpty();
        assertThat(page4.get("nextCursor").asString()).isEqualTo("5");
        assertThat(page1.get("changes").get(0).get("entityId").asString()).isEqualTo(products.get(0).toString());
        for (JsonNode page : List.of(page1, page2, page3, page4)) {
            assertThat(RESPONSE_SCHEMA.validate(page)).isEmpty();
        }
    }

    @Test
    void theSameCursorGivesTheSameChangesAndNewChangesOnlyAddToTheEnd() throws Exception {
        publishProducts(tenant, 3);
        JsonNode before = pull(tenant, "cursor=1");
        JsonNode again = pull(tenant, "cursor=1");

        publishProducts(tenant, 2);
        JsonNode later = pull(tenant, "cursor=1");

        assertThat(again).isEqualTo(before);
        assertThat(seqs(before)).containsExactly(2L, 3L);
        assertThat(seqs(later)).containsExactly(2L, 3L, 4L, 5L);
        assertThat(later.get("changes").get(0)).isEqualTo(before.get("changes").get(0));
    }

    @Test
    void aDeletedProductArrivesAsATombstoneWithNoPayload() throws Exception {
        UUID product = publishProducts(tenant, 1).getFirst();
        inTransaction(tenant, () -> publisher.publishDeletion(ChangePublisher.PRODUCT, product));

        JsonNode page = pull(tenant, "cursor=1");

        JsonNode tombstone = page.get("changes").get(0);
        assertThat(page.get("changes")).hasSize(1);
        assertThat(tombstone.get("deleted").asBoolean()).isTrue();
        assertThat(tombstone.get("entityId").asString()).isEqualTo(product.toString());
        assertThat(tombstone.has("payload")).isFalse();
        assertThat(RESPONSE_SCHEMA.validate(page)).isEmpty();
    }

    @Test
    void aPriceChangeAndAStaffMemberTravelWithTheWholeStateOfTheEntity() throws Exception {
        UUID product = Uuid7.next();
        UUID staff = Uuid7.next();
        inTransaction(tenant, () -> {
            publisher.publish(ChangePublisher.PRODUCT, product, productPayload("Cable THW", 386667));
            publisher.publish(ChangePublisher.PRODUCT, product, productPayload("Cable THW", 400000));
            ObjectNode member = JSON.createObjectNode();
            member.put("displayName", "Cajero de la tarde");
            member.put("role", "cashier");
            member.putArray("permissions").add("product.read").add("sync.push").add("sync.pull");
            member.put("active", true);
            publisher.publish(ChangePublisher.STAFF_MEMBER, staff, member);
        });

        JsonNode page = pull(tenant, "");

        assertThat(page.get("changes")).hasSize(3);
        assertThat(page.get("changes").get(0).get("payload").get("unitPriceE4").asLong()).isEqualTo(386667);
        assertThat(page.get("changes").get(1).get("payload").get("unitPriceE4").asLong()).isEqualTo(400000);
        assertThat(page.get("changes").get(2).get("entityType").asString()).isEqualTo("staff_member");
        assertThat(RESPONSE_SCHEMA.validate(page)).isEmpty();
    }

    @Test
    void aBusinessNeverSeesTheChangesOfAnotherAndEachNumbersItsOwn() throws Exception {
        publishProducts(tenant, 3);
        publishProducts(otherTenant, 1);

        JsonNode mine = pull(tenant, "");
        JsonNode theirs = pull(otherTenant, "");

        assertThat(seqs(mine)).containsExactly(1L, 2L, 3L);
        assertThat(seqs(theirs)).containsExactly(1L);
        assertThat(admin.queryForObject("SELECT count(*) FROM sync_change WHERE tenant_id = ?", Integer.class, tenant)).isEqualTo(3);
        mvc.perform(get("/sync/pull?tenantId=" + otherTenant).with(token(tenant))).andExpect(status().isBadRequest());
    }

    @Test
    void aCursorAheadOfTheCoreIsAConflictSoTheRegisterStartsAgain() throws Exception {
        publishProducts(tenant, 2);

        mvc.perform(get("/sync/pull?cursor=9").with(token(tenant)))
                .andExpect(status().isConflict())
                .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.code").value("cursor_ahead"));
        assertThat(seqs(pull(tenant, "cursor=2"))).isEmpty();
    }

    @Test
    void everyQueryOfTheSharedCasesIsHandledAsTheContractSays() throws Exception {
        for (JsonNode example : CASES.get("queries")) {
            String query = example.get("query").asString();
            if (query.contains("cursor=1042")) {
                continue; // The cursor of that example is beyond this business: covered by the conflict test.
            }
            mvc.perform(get("/sync/pull?" + query).with(token(tenant))).andExpect(status().isOk());
        }
        for (JsonNode example : CASES.get("query_rejections")) {
            mvc.perform(get("/sync/pull?" + example.get("query").asString()).with(token(tenant)))
                    .andExpect(status().isBadRequest());
        }
    }

    @Test
    void theLimitsOfThePageAreEnforcedAndTheMaximumWorks() throws Exception {
        publishProducts(tenant, 3);

        assertThat(seqs(pull(tenant, "limit=500"))).hasSize(3);
        mvc.perform(get("/sync/pull?limit=501").with(token(tenant))).andExpect(status().isBadRequest());
        mvc.perform(get("/sync/pull?limit=0").with(token(tenant))).andExpect(status().isBadRequest());
    }

    @Test
    void thePullNeedsTheDeviceCredentialOfARegister() throws Exception {
        mvc.perform(get("/sync/pull")).andExpect(status().isUnauthorized());
        mvc.perform(get("/sync/pull").header("Authorization", "Device " + tenant + "." + "A".repeat(43))).andExpect(status().isUnauthorized());
        mvc.perform(get("/sync/pull").with(jwt().jwt(token -> token.subject("someone").claim("tenant_id", tenant.toString()))))
                .andExpect(status().isForbidden());
    }

    @Test
    void aRevokedRegisterStopsPulling() throws Exception {
        RequestPostProcessor credential = token(tenant);
        mvc.perform(get("/sync/pull").with(credential)).andExpect(status().isOk());

        UUID owner = Uuid7.next();
        admin.update("INSERT INTO app_user (id, tenant_id, display_name, role) VALUES (?, ?, 'Owner', 'owner')", owner, tenant);
        admin.update("UPDATE register_device SET revoked_at = now(), revoked_by = ? WHERE tenant_id = ?", owner, tenant);

        mvc.perform(get("/sync/pull").with(credential)).andExpect(status().isUnauthorized());
    }

    @Test
    void aFeedRowCannotBeEditedOrRemovedEvenByTheOwnerOfTheTable() {
        publishProducts(tenant, 1);

        assertThatThrownBy(() -> admin.update("UPDATE sync_change SET deleted = true, payload = NULL WHERE tenant_id = ?", tenant))
                .rootCause().hasMessageContaining("append-only");
        assertThatThrownBy(() -> admin.update("DELETE FROM sync_change WHERE tenant_id = ?", tenant))
                .rootCause().hasMessageContaining("append-only");
    }

    @Test
    void aTransactionThatPublishesBlocksTheNextOneSoNumbersFollowTheCommitsAndANumberIsNeverSkipped() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch firstHoldsTheNumber = new CountDownLatch(1);
            CountDownLatch letFirstFinish = new CountDownLatch(1);
            AtomicBoolean secondDone = new AtomicBoolean();

            Future<?> first = pool.submit(() -> TenantContext.callAs(tenant, () -> transaction.execute(status -> {
                publisher.publish(ChangePublisher.PRODUCT, Uuid7.next(), productPayload("First", 100));
                firstHoldsTheNumber.countDown();
                await(letFirstFinish);
                return null;
            })));
            assertThat(firstHoldsTheNumber.await(10, TimeUnit.SECONDS)).isTrue();
            Future<?> second = pool.submit(() -> {
                inTransaction(tenant, () -> publisher.publish(ChangePublisher.PRODUCT, Uuid7.next(), productPayload("Second", 200)));
                secondDone.set(true);
            });

            Thread.sleep(500);
            assertThat(secondDone).as("the second publisher waits for the first to commit").isFalse();
            assertThat(seqs(pull(tenant, ""))).as("nothing is visible until the first commits").isEmpty();

            letFirstFinish.countDown();
            first.get(10, TimeUnit.SECONDS);
            second.get(10, TimeUnit.SECONDS);

            JsonNode page = pull(tenant, "");
            assertThat(seqs(page)).containsExactly(1L, 2L);
            assertThat(page.get("changes").get(0).get("payload").get("name").asString()).isEqualTo("First");
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    void aRolledBackPublicationLeavesNoHoleInTheNumbers() throws Exception {
        try {
            inTransaction(tenant, () -> {
                publisher.publish(ChangePublisher.PRODUCT, Uuid7.next(), productPayload("Never saved", 100));
                throw new IllegalStateException("The product change failed");
            });
        } catch (IllegalStateException expected) {
            // The change and its announcement are lost together.
        }
        publishProducts(tenant, 1);

        assertThat(seqs(pull(tenant, ""))).containsExactly(1L);
    }

    @Test
    void aReaderPagingWhileManyThreadsPublishSeesEveryChangeOnceInOrderWithNoSkips() throws Exception {
        int writers = 6;
        int changesEach = 25;
        ExecutorService pool = Executors.newFixedThreadPool(writers + 1);
        try {
            AtomicBoolean writing = new AtomicBoolean(true);
            Future<List<Long>> reader = pool.submit(() -> {
                List<Long> seen = new ArrayList<>();
                String cursor = "0";
                boolean lastRoundSawNothing = false;
                while (writing.get() || !lastRoundSawNothing) {
                    JsonNode page = pull(tenant, "cursor=" + cursor + "&limit=7");
                    seqs(page).forEach(seen::add);
                    cursor = page.get("nextCursor").asString();
                    lastRoundSawNothing = page.get("changes").isEmpty();
                }
                return seen;
            });
            CountDownLatch start = new CountDownLatch(1);
            List<Future<?>> runs = new ArrayList<>();
            for (int writer = 0; writer < writers; writer++) {
                Callable<Object> run = () -> {
                    start.await();
                    for (int i = 0; i < changesEach; i++) {
                        inTransaction(tenant, () -> publisher.publish(ChangePublisher.PRODUCT, Uuid7.next(), productPayload("Item", 100)));
                    }
                    return null;
                };
                runs.add(pool.submit(run));
            }
            start.countDown();
            for (Future<?> run : runs) {
                run.get(60, TimeUnit.SECONDS);
            }
            writing.set(false);

            List<Long> seen = reader.get(60, TimeUnit.SECONDS);
            assertThat(seen).hasSize(writers * changesEach);
            for (int i = 0; i < seen.size(); i++) {
                assertThat(seen.get(i)).as("change %d", i).isEqualTo(i + 1L);
            }
        } finally {
            pool.shutdownNow();
        }
    }

    private List<UUID> publishProducts(UUID business, int count) {
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            UUID id = Uuid7.next();
            ids.add(id);
            inTransaction(business, () -> publisher.publish(ChangePublisher.PRODUCT, id, productPayload("Product", 100)));
        }
        return ids;
    }

    private static ObjectNode productPayload(String name, long unitPriceE4) {
        ObjectNode payload = JSON.createObjectNode();
        payload.put("name", name);
        payload.put("baseUnit", "meter");
        payload.put("unitPriceE4", unitPriceE4);
        payload.put("taxFactor", "rate");
        payload.put("taxRateBp", 1600);
        payload.putArray("barcodes");
        return payload;
    }

    private void inTransaction(UUID business, Runnable work) {
        TenantContext.callAs(business, () -> transaction.execute(status -> {
            work.run();
            return null;
        }));
    }

    private JsonNode pull(UUID business, String query) throws Exception {
        String body = mvc.perform(get(query.isEmpty() ? "/sync/pull" : "/sync/pull?" + query).with(token(business)))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return JSON.readTree(body);
    }

    private static List<Long> seqs(JsonNode page) {
        List<Long> seqs = new ArrayList<>();
        page.get("changes").forEach(change -> seqs.add(change.get("seq").asLong()));
        return seqs;
    }

    private static void await(CountDownLatch latch) {
        try {
            latch.await(10, TimeUnit.SECONDS);
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
        }
    }

    /** The device credential of a register of the business, enrolled on first use (ADR 0054). */
    private RequestPostProcessor token(UUID business) {
        return DeviceFixtures.device(credentials.computeIfAbsent(business, id -> DeviceFixtures.enroll(admin, id, Uuid7.next())));
    }

    private static JsonNode readCases() {
        try (InputStream in = SyncPullTest.class.getResourceAsStream("/contracts/cases/sync-pull.json")) {
            return JSON.readTree(java.util.Objects.requireNonNull(in));
        } catch (IOException failure) {
            throw new IllegalStateException(failure);
        }
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
