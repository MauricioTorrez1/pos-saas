package io.github.mauriciotorrez1.pos.core.sync;

import static io.github.mauriciotorrez1.pos.core.sync.SyncFixtures.JSON;
import static io.github.mauriciotorrez1.pos.core.sync.SyncFixtures.batch;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.networknt.schema.Schema;
import com.networknt.schema.SchemaLocation;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SpecificationVersion;
import com.zaxxer.hikari.HikariDataSource;
import io.github.mauriciotorrez1.pos.core.CoreApplication;
import io.github.mauriciotorrez1.pos.db.PostgresTestConfiguration;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import io.github.mauriciotorrez1.pos.ingest.OperationRecorder;
import io.github.mauriciotorrez1.pos.ingest.RegisterOperation;
import io.github.mauriciotorrez1.pos.tenant.TenantContext;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.sql.DataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.BeansException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.beans.factory.config.BeanPostProcessor;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataAccessException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.DynamicPropertyRegistrar;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * POST /sync/push stores each operation once, answers per operation and keeps businesses apart
 * (RF-021, E1-17). The database is a real PostgreSQL, so the unique constraint, row-level security
 * and the transactions are the ones of production; only the token is faked, because the validation
 * of real Keycloak tokens is covered by KeycloakResourceServerTest.
 */
@SpringBootTest(classes = CoreApplication.class)
@AutoConfigureMockMvc
@Import({PostgresTestConfiguration.class, SyncPushTest.WidePoolAndFlakyStock.class})
class SyncPushTest {

    private static final Schema RESPONSE_SCHEMA = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12)
            .getSchema(SchemaLocation.of("classpath:contracts/schemas/sync-push-response.schema.json"));

    @Autowired
    private MockMvc mvc;

    @Autowired
    private SyncPushService service;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private JdbcTemplate app;

    @Autowired
    @Qualifier("adminJdbc")
    private JdbcTemplate admin;

    @Autowired
    private TransactionTemplate transaction;

    private FailingStock failingStock;

    @Autowired
    void findFailingStock(List<OperationRecorder> recorders) {
        failingStock = recorders.stream().filter(FailingStock.class::isInstance).map(FailingStock.class::cast).findFirst().orElseThrow();
    }

    private final UUID tenant = Uuid7.next();
    private final UUID otherTenant = Uuid7.next();
    private final UUID register = Uuid7.next();

    @BeforeEach
    void stockWorks() {
        failingStock.failing.set(false);
    }

    @Test
    void aBatchIsStoredAndAnsweredPerOperationInTheShapeOfTheContract() throws Exception {
        UUID saleOp = Uuid7.next();
        UUID sessionOp = Uuid7.next();
        JsonNode response = push(tenant, batch(register, SyncFixtures.sale(saleOp),
                SyncFixtures.cashSessionOpened(sessionOp, Uuid7.next())));

        assertThat(response.get("results")).hasSize(2);
        assertThat(statuses(response)).containsExactly("accepted", "accepted");
        assertThat(response.get("results").get(0).get("opId").asString()).isEqualTo(saleOp.toString());
        assertThat(RESPONSE_SCHEMA.validate(response)).isEmpty();
        assertThat(count("sale", tenant)).isOne();
        assertThat(count("sale_line", tenant)).isOne();
        assertThat(count("sale_payment", tenant)).isOne();
        assertThat(count("cash_session", tenant)).isOne();
        assertThat(count("sync_operation", tenant)).isEqualTo(2);
    }

    @Test
    void theSameBatchTwiceStoresEverythingOnce() throws Exception {
        ObjectNode batch = batch(register, SyncFixtures.sale(Uuid7.next()), SyncFixtures.sale(Uuid7.next()));

        assertThat(statuses(push(tenant, batch))).containsExactly("accepted", "accepted");
        JsonNode second = push(tenant, batch);

        assertThat(statuses(second)).containsExactly("duplicate", "duplicate");
        assertThat(RESPONSE_SCHEMA.validate(second)).isEmpty();
        assertThat(count("sale", tenant)).isEqualTo(2);
        assertThat(count("sync_operation", tenant)).isEqualTo(2);
    }

    @Test
    void aRepeatedOperationInsideOneBatchIsStoredOnce() throws Exception {
        ObjectNode sale = SyncFixtures.sale(Uuid7.next());

        assertThat(statuses(push(tenant, batch(register, sale, sale)))).containsExactly("accepted", "duplicate");
        assertThat(count("sale", tenant)).isOne();
    }

    @Test
    void manyThreadsSendingTheSameBatchAtTheSameTimeStoreEachOperationOnce() throws Exception {
        assertThat(((HikariDataSource) dataSource).getMaximumPoolSize()).as("a pool that allows real concurrency").isGreaterThan(4);
        int threads = 8;
        ObjectNode batch = batch(register, SyncFixtures.sale(Uuid7.next()), SyncFixtures.sale(Uuid7.next()),
                SyncFixtures.cashSessionOpened(Uuid7.next(), Uuid7.next()), SyncFixtures.sale(Uuid7.next()),
                SyncFixtures.stockAdjusted(Uuid7.next(), Uuid7.next(), Uuid7.next()));

        ExecutorService pool = Executors.newFixedThreadPool(threads);
        try {
            CountDownLatch start = new CountDownLatch(1);
            List<Future<List<SyncResult>>> runs = new ArrayList<>();
            for (int i = 0; i < threads; i++) {
                Callable<List<SyncResult>> run = () -> {
                    start.await();
                    return TenantContext.callAs(tenant, () -> service.push(batch).results());
                };
                runs.add(pool.submit(run));
            }
            start.countDown();
            List<SyncResult> all = new ArrayList<>();
            for (Future<List<SyncResult>> run : runs) {
                all.addAll(run.get(60, TimeUnit.SECONDS));
            }

            assertThat(all).hasSize(threads * 5);
            assertThat(all.stream().filter(result -> result.status().equals("accepted"))).hasSize(5);
            assertThat(all.stream().filter(result -> result.status().equals("duplicate"))).hasSize(threads * 5 - 5);
        } finally {
            pool.shutdownNow();
        }
        assertThat(count("sale", tenant)).isEqualTo(3);
        assertThat(count("cash_session", tenant)).isOne();
        assertThat(count("stock_movement", tenant)).isOne();
        assertThat(count("sync_operation", tenant)).isEqualTo(5);
    }

    @Test
    void aBatchThatIsPartlyInvalidKeepsTheGoodOnesAndQuarantinesTheRest() throws Exception {
        ObjectNode good = SyncFixtures.sale(Uuid7.next());
        ObjectNode zeroTotal = SyncFixtures.sale(Uuid7.next());
        ((ObjectNode) zeroTotal.get("payload")).put("totalCents", 0);
        ObjectNode unknownType = SyncFixtures.sale(Uuid7.next());
        unknownType.put("type", "loyalty.points_awarded");
        ObjectNode futureVersion = SyncFixtures.sale(Uuid7.next());
        futureVersion.put("schemaVersion", 2);
        ObjectNode extraField = SyncFixtures.sale(Uuid7.next());
        ((ObjectNode) extraField.get("payload")).put("discountCents", 100);
        ObjectNode alsoGood = SyncFixtures.cashSessionOpened(Uuid7.next(), Uuid7.next());

        JsonNode response = push(tenant, batch(register, good, zeroTotal, unknownType, futureVersion, extraField, alsoGood));

        assertThat(statuses(response)).containsExactly("accepted", "quarantined", "quarantined", "quarantined", "quarantined", "accepted");
        assertThat(RESPONSE_SCHEMA.validate(response)).isEmpty();
        JsonNode results = response.get("results");
        for (int i : new int[] {1, 2, 3, 4}) {
            assertThat(results.get(i).get("reason").asString()).isNotBlank().hasSizeLessThanOrEqualTo(500);
        }
        assertThat(results.get(2).get("reason").asString()).contains("operation type");
        assertThat(results.get(3).get("reason").asString()).contains("schemaVersion");
        assertThat(count("sale", tenant)).as("only the valid sale becomes a sale").isOne();
        assertThat(count("cash_session", tenant)).isOne();
        // Nothing is lost: the four invalid operations are kept exactly as they arrived, for the owner.
        assertThat(admin.queryForList("SELECT raw_operation->>'type' FROM sync_operation WHERE tenant_id = ? AND status = 'quarantined' ORDER BY received_at",
                String.class, tenant)).hasSize(4).contains("loyalty.points_awarded");
        assertThat(admin.queryForObject("SELECT count(*) FROM sync_operation WHERE tenant_id = ? AND status = 'quarantined' AND reason IS NOT NULL",
                Integer.class, tenant)).isEqualTo(4);
    }

    @Test
    void aQuarantinedOperationSentAgainIsADuplicateNotANewQuarantine() throws Exception {
        ObjectNode invalid = SyncFixtures.sale(Uuid7.next());
        invalid.put("type", "loyalty.points_awarded");

        assertThat(statuses(push(tenant, batch(register, invalid)))).containsExactly("quarantined");
        assertThat(statuses(push(tenant, batch(register, invalid)))).containsExactly("duplicate");
        assertThat(count("sync_operation", tenant)).isOne();
    }

    @Test
    void aSaleWhoseNumbersDoNotAddUpIsQuarantinedAndNeverEntersTheBooks() throws Exception {
        ObjectNode payments = SyncFixtures.sale(Uuid7.next());
        ((ObjectNode) ((tools.jackson.databind.node.ArrayNode) payments.get("payload").get("payments")).get(0)).put("amountCents", 11000);
        ObjectNode lines = SyncFixtures.sale(Uuid7.next());
        ((ObjectNode) lines.get("payload")).put("subtotalCents", 9000).put("totalCents", 10600);
        UUID saleId = Uuid7.next();
        ObjectNode sameSaleOtherOp = SyncFixtures.sale(Uuid7.next(), saleId, Uuid7.next());
        ObjectNode sameSale = SyncFixtures.sale(Uuid7.next(), saleId, Uuid7.next());

        JsonNode response = push(tenant, batch(register, payments, lines, sameSale, sameSaleOtherOp));

        assertThat(statuses(response)).containsExactly("quarantined", "quarantined", "accepted", "quarantined");
        assertThat(response.get("results").get(0).get("reason").asString()).isEqualTo("The payments do not add up to the total");
        assertThat(response.get("results").get(1).get("reason").asString()).isEqualTo("The lines do not add up to the sale totals");
        assertThat(response.get("results").get(3).get("reason").asString()).contains("already recorded");
        assertThat(count("sale", tenant)).as("the same sale under a second op_id is not a second sale").isOne();
    }

    @Test
    void returnsAreCheckedAgainstTheSaleTheyBelongTo() throws Exception {
        UUID saleId = Uuid7.next();
        UUID lineId = Uuid7.next();
        ObjectNode sale = SyncFixtures.sale(Uuid7.next(), saleId, lineId);

        JsonNode response = push(tenant, batch(register, sale,
                SyncFixtures.saleReturn(Uuid7.next(), saleId, lineId, 1000, 3866),
                SyncFixtures.saleReturn(Uuid7.next(), saleId, lineId, 2000, 7733),
                SyncFixtures.saleReturn(Uuid7.next(), saleId, lineId, 1000, 3866),
                SyncFixtures.saleReturn(Uuid7.next(), Uuid7.next(), lineId, 1000, 3866)));

        assertThat(statuses(response)).containsExactly("accepted", "accepted", "accepted", "quarantined", "quarantined");
        assertThat(response.get("results").get(3).get("reason").asString()).contains("more than was sold");
        assertThat(response.get("results").get(4).get("reason").asString()).contains("sale that the core does not have");
        assertThat(admin.queryForObject("SELECT sum(quantity_milli) FROM sale_return_line WHERE tenant_id = ?", Long.class, tenant))
                .isEqualTo(3000L);
    }

    @Test
    void aLowerDeviceSeqIsNotRejected() throws Exception {
        ObjectNode later = SyncFixtures.sale(Uuid7.next());
        later.put("deviceSeq", 5000);
        ObjectNode restoredFromBackup = SyncFixtures.sale(Uuid7.next());
        restoredFromBackup.put("deviceSeq", 12);

        assertThat(statuses(push(tenant, batch(register, later)))).containsExactly("accepted");
        assertThat(statuses(push(tenant, batch(register, restoredFromBackup)))).containsExactly("accepted");
    }

    @Test
    void cutsAndAdjustmentsGoToTheAuditLogInTheSameTransaction() throws Exception {
        UUID sessionId = Uuid7.next();
        UUID cutId = Uuid7.next();
        UUID closedBy = Uuid7.next();
        UUID movementId = Uuid7.next();
        UUID userId = Uuid7.next();

        JsonNode response = push(tenant, batch(register,
                SyncFixtures.cashSessionOpened(Uuid7.next(), sessionId),
                SyncFixtures.cashMovement(Uuid7.next(), sessionId),
                SyncFixtures.cashCut(Uuid7.next(), sessionId, cutId, closedBy),
                SyncFixtures.stockAdjusted(Uuid7.next(), movementId, userId),
                SyncFixtures.cashCut(Uuid7.next(), Uuid7.next(), Uuid7.next(), closedBy)));

        assertThat(statuses(response)).containsExactly("accepted", "accepted", "accepted", "accepted", "quarantined");
        var cut = admin.queryForMap("SELECT * FROM audit_log WHERE tenant_id = ? AND entity_id = ?", tenant, cutId);
        assertThat(cut.get("actor_id")).isEqualTo(closedBy);
        assertThat(cut.get("action")).isEqualTo("cash_session.closed");
        assertThat(cut.get("new_value").toString()).contains("41600").contains("41500");
        var adjustment = admin.queryForMap("SELECT * FROM audit_log WHERE tenant_id = ? AND entity_id = ?", tenant, movementId);
        assertThat(adjustment.get("actor_id")).isEqualTo(userId);
        assertThat(adjustment.get("action")).isEqualTo("stock.waste");
        assertThat(admin.queryForObject("SELECT count(*) FROM audit_log WHERE tenant_id = ?", Integer.class, tenant))
                .as("the cut of an unknown session leaves no audit entry behind").isEqualTo(2);
        assertThat(count("cash_cut", tenant)).isOne();
    }

    @Test
    void anOperationThatFailsLeavesNothingOfItselfBehind() {
        // The recorder fails after it wrote the movement and its audit entry: all of it must be undone.
        ObjectNode adjustment = SyncFixtures.stockAdjusted(Uuid7.next(), Uuid7.next(), Uuid7.next());
        failingStock.failing.set(true);

        SyncPushService.PushOutcome outcome = TenantContext.callAs(tenant, () -> service.push(batch(register, adjustment)));

        assertThat(outcome.stopped()).isTrue();
        assertThat(outcome.results()).isEmpty();
        assertThat(count("stock_movement", tenant)).isZero();
        assertThat(count("audit_log", tenant)).isZero();
        assertThat(count("sync_operation", tenant)).as("the claim is lost with the failed operation").isZero();
    }

    @Test
    void whenTheCoreFailsHalfwayTheEarlierOperationsStayConfirmedAndTheRestIsLeftToResend() throws Exception {
        ObjectNode first = SyncFixtures.sale(Uuid7.next());
        ObjectNode second = SyncFixtures.cashSessionOpened(Uuid7.next(), Uuid7.next());
        ObjectNode failing = SyncFixtures.stockAdjusted(Uuid7.next(), Uuid7.next(), Uuid7.next());
        ObjectNode never = SyncFixtures.sale(Uuid7.next());
        failingStock.failing.set(true);

        JsonNode half = push(tenant, batch(register, first, second, failing, never));

        assertThat(statuses(half)).as("only what was handled is confirmed").containsExactly("accepted", "accepted");
        assertThat(RESPONSE_SCHEMA.validate(half)).isEmpty();
        assertThat(count("sale", tenant)).isOne();

        failingStock.failing.set(false);
        assertThat(statuses(push(tenant, batch(register, first, second, failing, never))))
                .containsExactly("duplicate", "duplicate", "accepted", "accepted");
        assertThat(count("sale", tenant)).isEqualTo(2);
    }

    @Test
    void whenTheCoreCannotHandleEvenTheFirstOperationTheAnswerIs503() throws Exception {
        failingStock.failing.set(true);

        mvc.perform(post("/sync/push").with(token(tenant)).contentType(MediaType.APPLICATION_JSON)
                        .content(batch(register, SyncFixtures.stockAdjusted(Uuid7.next(), Uuid7.next(), Uuid7.next())).toString()))
                .andExpect(status().isServiceUnavailable());
    }

    @Test
    void twoBusinessesKeepTheirOwnOperationsAndNeverCollide() throws Exception {
        UUID opId = Uuid7.next();
        UUID saleId = Uuid7.next();
        UUID lineId = Uuid7.next();
        ObjectNode sale = SyncFixtures.sale(opId, saleId, lineId);

        assertThat(statuses(push(tenant, batch(register, sale)))).containsExactly("accepted");
        // Another business uses the same ids: the key is per business, so it is a new operation, not a duplicate.
        assertThat(statuses(push(otherTenant, batch(register, sale)))).containsExactly("accepted");

        assertThat(count("sale", tenant)).isOne();
        assertThat(count("sale", otherTenant)).isOne();
        assertThat(seenByApplication(tenant, "sale")).isOne();
        assertThat(seenByApplication(otherTenant, "sale")).isOne();
        assertThat(seenByApplication(Uuid7.next(), "sale")).as("a third business sees nothing").isZero();
        assertThat(seenByApplication(tenant, "sync_operation")).isOne();
    }

    @Test
    void aBodyThatNamesAnotherBusinessIsRefusedAndTheBusinessOfTheTokenIsUsedAlways() throws Exception {
        ObjectNode forged = batch(register, SyncFixtures.sale(Uuid7.next()));
        forged.put("tenantId", otherTenant.toString());

        mvc.perform(post("/sync/push").with(token(tenant)).contentType(MediaType.APPLICATION_JSON).content(forged.toString()))
                .andExpect(status().isBadRequest());
        assertThat(count("sync_operation", tenant)).isZero();
        assertThat(count("sync_operation", otherTenant)).isZero();

        forged.remove("tenantId");
        assertThat(statuses(push(tenant, forged))).containsExactly("accepted");
        assertThat(count("sale", tenant)).isOne();
        assertThat(count("sale", otherTenant)).isZero();
    }

    @Test
    void theApplicationCannotWriteForAnotherBusinessEvenWithSql() {
        UUID ownSale = Uuid7.next();
        assertThatThrownBy(() -> TenantContext.runAs(tenant, () -> transaction.executeWithoutResult(status -> app.update(
                "INSERT INTO sync_operation (tenant_id, op_id, register_id, type, status, raw_operation) VALUES (?, ?, ?, 'x', 'accepted', '{}'::jsonb)",
                otherTenant, ownSale, register)))).isInstanceOf(DataAccessException.class);
    }

    @Test
    void storedSalesCannotBeEditedNorDeleted() throws Exception {
        UUID saleId = Uuid7.next();
        push(tenant, batch(register, SyncFixtures.sale(Uuid7.next(), saleId, Uuid7.next())));

        assertThatThrownBy(() -> TenantContext.runAs(tenant, () -> transaction.executeWithoutResult(status ->
                app.update("UPDATE sale SET total_cents = 1 WHERE id = ?", saleId)))).isInstanceOf(DataAccessException.class);
        assertThatThrownBy(() -> admin.update("DELETE FROM sale WHERE id = ?", saleId))
                .rootCause().hasMessageContaining("append-only");
        assertThat(admin.queryForObject("SELECT total_cents FROM sale WHERE id = ?", Long.class, saleId)).isEqualTo(11600L);
    }

    @Test
    void aMalformedEnvelopeIsRefusedAndNothingIsConfirmed() throws Exception {
        ObjectNode valid = SyncFixtures.sale(Uuid7.next());
        ObjectNode withoutOpId = valid.deepCopy();
        withoutOpId.remove("opId");
        ObjectNode opIdV4 = valid.deepCopy();
        opIdV4.put("opId", "9b2f5a43-6c1e-4d0b-8a77-2f4c1e9d7a10");
        ObjectNode registerV4 = batch(register, valid);
        registerV4.put("registerId", "9b2f5a43-6c1e-4d0b-8a77-2f4c1e9d7a10");
        ObjectNode tooMany = batch(register);
        for (int i = 0; i < 101; i++) {
            ((tools.jackson.databind.node.ArrayNode) tooMany.get("operations")).add(SyncFixtures.sale(Uuid7.next()));
        }
        List<String> bodies = List.of(
                batch(register).toString(),
                tooMany.toString(),
                batch(register, withoutOpId).toString(),
                batch(register, opIdV4).toString(),
                registerV4.toString(),
                "[]",
                "{\"registerId\": 5}",
                "not json at all");

        for (String body : bodies) {
            mvc.perform(post("/sync/push").with(token(tenant)).contentType(MediaType.APPLICATION_JSON).content(body))
                    .andExpect(status().isBadRequest());
        }
        assertThat(count("sync_operation", tenant)).isZero();
    }

    @Test
    void theEndpointNeedsAValidTokenWithABusiness() throws Exception {
        String body = batch(register, SyncFixtures.sale(Uuid7.next())).toString();

        mvc.perform(post("/sync/push").contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isUnauthorized());
        mvc.perform(post("/sync/push").with(jwt().jwt(token -> token.subject("someone"))).contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isForbidden());
        mvc.perform(post("/sync/push").with(token(tenant)).contentType(MediaType.TEXT_PLAIN).content(body))
                .andExpect(status().isUnsupportedMediaType());
    }

    private JsonNode push(UUID business, ObjectNode batch) throws Exception {
        String body = mvc.perform(post("/sync/push").with(token(business)).contentType(MediaType.APPLICATION_JSON).content(batch.toString()))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return JSON.readTree(body);
    }

    private static JwtRequestPostProcessor token(UUID business) {
        return jwt().jwt(token -> token.subject("register-credential").claim("tenant_id", business.toString()));
    }

    private static List<String> statuses(JsonNode response) {
        List<String> statuses = new ArrayList<>();
        response.get("results").forEach(result -> statuses.add(result.get("status").asString()));
        return statuses;
    }

    private int count(String table, UUID business) {
        return admin.queryForObject("SELECT count(*) FROM " + table + " WHERE tenant_id = ?", Integer.class, business);
    }

    /** Counts through the application role, so row-level security decides what is visible. */
    private int seenByApplication(UUID business, String table) {
        return TenantContext.callAs(business, () -> transaction.execute(
                status -> app.queryForObject("SELECT count(*) FROM " + table, Integer.class)));
    }

    /** Makes the stock recorder fail on demand, to simulate a failure that is not a business rule. */
    static final class FailingStock implements OperationRecorder {

        private final OperationRecorder delegate;
        final AtomicBoolean failing = new AtomicBoolean();

        FailingStock(OperationRecorder delegate) {
            this.delegate = delegate;
        }

        @Override
        public Set<String> types() {
            return delegate.types();
        }

        @Override
        public void record(RegisterOperation operation) {
            delegate.record(operation);
            if (failing.get()) {
                throw new IllegalStateException("The database went away");
            }
        }
    }

    /** A pool wide enough for real concurrency (the shared test pool has one connection), and the failing recorder. */
    @TestConfiguration(proxyBeanMethods = false)
    static class WidePoolAndFlakyStock {

        @Bean
        DynamicPropertyRegistrar widePool() {
            return registry -> registry.add("spring.datasource.hikari.maximum-pool-size", () -> 12);
        }

        @Bean
        static BeanPostProcessor failingStockRecorder() {
            return new BeanPostProcessor() {
                @Override
                public Object postProcessAfterInitialization(Object bean, String beanName) throws BeansException {
                    if (bean instanceof OperationRecorder recorder && recorder.types().contains("stock.adjusted")) {
                        return new FailingStock(recorder);
                    }
                    return bean;
                }
            };
        }
    }
}
