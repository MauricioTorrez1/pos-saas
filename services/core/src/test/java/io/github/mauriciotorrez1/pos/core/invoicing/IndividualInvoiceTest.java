package io.github.mauriciotorrez1.pos.core.invoicing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import io.github.mauriciotorrez1.pos.core.CoreApplication;
import io.github.mauriciotorrez1.pos.core.invoicing.InvoiceFailures.InvoiceInProgressException;
import io.github.mauriciotorrez1.pos.core.invoicing.InvoiceFailures.InvoiceNotIssuedException;
import io.github.mauriciotorrez1.pos.core.invoicing.InvoiceFailures.SaleAlreadyInvoicedException;
import io.github.mauriciotorrez1.pos.core.invoicing.InvoiceFailures.SaleNotFoundException;
import io.github.mauriciotorrez1.pos.db.PostgresTestConfiguration;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import io.github.mauriciotorrez1.pos.tenant.TenantContext;
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
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.dao.DataAccessException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.context.DynamicPropertyRegistrar;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Individual invoice of a sale (E1-31, RF-035): real PostgreSQL with row-level security, the real HTTP layer and
 * permissions, and a fake provider. What depends on the real Facturapi test mode is not covered here.
 */
@SpringBootTest(classes = CoreApplication.class, properties = "invoicing.default-sat-product-key=27112700")
@AutoConfigureMockMvc
@Import({PostgresTestConfiguration.class, IndividualInvoiceTest.FakeProvider.class})
class IndividualInvoiceTest {

    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final String RFC = "ABC010203AB1";
    private static final String LEGAL_NAME = "ACME FERRETERIA SA";

    @Autowired
    private MockMvc mvc;

    @Autowired
    private IndividualInvoiceService service;

    @Autowired
    private FakeFiscalInvoicing provider;

    @Autowired
    private JdbcTemplate app;

    @Autowired
    private TransactionTemplate transaction;

    @Autowired
    @Qualifier("adminJdbc")
    private JdbcTemplate admin;

    private final UUID tenant = Uuid7.next();
    private final UUID otherTenant = Uuid7.next();
    private ListAppender<ILoggingEvent> logs;

    @BeforeEach
    void seedAndListenToLogs() {
        provider.reset();
        seedTenant(tenant);
        seedTenant(otherTenant);
        logs = new ListAppender<>();
        logs.start();
        ((Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME)).addAppender(logs);
    }

    @AfterEach
    void stopListening() {
        ((Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME)).detachAppender(logs);
    }

    @Test
    void stampsTheInvoiceOfASaleAndSavesTheFiscalUuidAndTheAudit() throws Exception {
        UUID sale = seedSale(tenant);

        MvcResult result = send(tenant, "owner", body(sale, validReceiver()));

        assertThat(result.getResponse().getStatus()).isEqualTo(201);
        JsonNode answer = JSON.readTree(result.getResponse().getContentAsString());
        assertThat(answer.get("status").asString()).isEqualTo("stamped");
        assertThat(answer.get("totalCents").asLong()).isEqualTo(11600);
        Map<String, Object> row = admin.queryForMap("SELECT * FROM invoice WHERE sale_id = ?", sale);
        assertThat(row).containsEntry("status", "stamped").containsEntry("receiver_tax_id", RFC);
        assertThat(row.get("fiscal_uuid").toString()).isEqualTo(answer.get("fiscalUuid").asString());
        assertThat(row.get("provider_invoice_id")).isNotNull();
        assertThat(row.get("attempts")).isEqualTo(1);
        // Only the RFC is stored: no column holds the name, address or e-mail.
        assertThat(admin.queryForList("SELECT column_name FROM information_schema.columns WHERE table_name = 'invoice'", String.class))
                .doesNotContain("legal_name", "zip_code", "email", "tax_regime", "pdf", "xml");

        InvoiceDraft sent = provider.drafts.get(0);
        assertThat(sent.externalId()).isEqualTo(row.get("id").toString());
        assertThat(sent.paymentForm()).isEqualTo("01");
        assertThat(sent.cfdiUse()).isEqualTo("G03");
        assertThat(sent.lines()).singleElement().satisfies(line -> {
            assertThat(line.satProductKey()).isEqualTo("27112700");
            assertThat(line.satUnitKey()).isEqualTo("MTR");
            assertThat(line.unitPriceE4()).isEqualTo(386667);
            assertThat(line.quantityMilli()).isEqualTo(3000);
            assertThat(line.taxRateBasisPoints()).isEqualTo(1600);
        });

        Map<String, Object> audit = admin.queryForMap(
                "SELECT new_value::text AS detail FROM audit_log WHERE tenant_id = ? AND action = 'invoice.stamped' AND entity_id = ?",
                tenant, row.get("id"));
        assertThat(audit.get("detail").toString()).contains(answer.get("fiscalUuid").asString()).doesNotContain(RFC).doesNotContain(LEGAL_NAME);
    }

    @Test
    void aLineCanCarryItsOwnSatProductKey() throws Exception {
        UUID sale = seedSale(tenant);
        UUID line = admin.queryForObject("SELECT id FROM sale_line WHERE sale_id = ?", UUID.class, sale);
        ObjectNode request = body(sale, validReceiver());
        request.putObject("satProductKeys").put(line.toString(), "30161700");
        request.put("paymentForm", "03");

        assertThat(send(tenant, "manager", request).getResponse().getStatus()).isEqualTo(201);

        assertThat(provider.drafts.get(0).lines().get(0).satProductKey()).isEqualTo("30161700");
        assertThat(provider.drafts.get(0).paymentForm()).isEqualTo("03");
    }

    @Test
    void invalidFiscalDataIsRefusedWithTheBrokenRulesAndNothingIsSentOrStored() throws Exception {
        UUID sale = seedSale(tenant);
        ObjectNode receiver = validReceiver();
        receiver.put("taxId", "NOT-AN-RFC").put("zipCode", "123").put("taxRegime", "612");

        MvcResult result = send(tenant, "owner", body(sale, receiver));

        assertThat(result.getResponse().getStatus()).isEqualTo(422);
        String answer = result.getResponse().getContentAsString();
        assertThat(answer).contains("receiver.taxId", "invalid_format", "receiver.zipCode").doesNotContain("NOT-AN-RFC");
        assertThat(provider.customerCalls.get() + provider.createCalls.get()).isZero();
        assertThat(count("invoice", tenant)).isZero();
    }

    @Test
    void aBadSatKeyOrPaymentFormIsRefused() throws Exception {
        UUID sale = seedSale(tenant);
        ObjectNode request = body(sale, validReceiver());
        request.put("paymentForm", "7");
        request.putObject("satProductKeys").put(admin.queryForObject("SELECT id FROM sale_line WHERE sale_id = ?", String.class, sale), "12");

        MvcResult result = send(tenant, "owner", request);

        assertThat(result.getResponse().getStatus()).isEqualTo(422);
        assertThat(result.getResponse().getContentAsString()).contains("paymentForm", "satProductKey");
        assertThat(provider.createCalls.get()).isZero();
    }

    @Test
    void aMissingBodyFieldIsRefused() throws Exception {
        assertThat(send(tenant, "owner", JSON.createObjectNode()).getResponse().getStatus()).isEqualTo(422);
    }

    @Test
    void aSaleTheCoreDoesNotHaveIsNotFoundAndNeitherIsASaleOfAnotherBusiness() throws Exception {
        UUID foreignSale = seedSale(otherTenant);

        assertThat(send(tenant, "owner", body(Uuid7.next(), validReceiver())).getResponse().getStatus()).isEqualTo(404);
        assertThat(send(tenant, "owner", body(foreignSale, validReceiver())).getResponse().getStatus()).isEqualTo(404);
        assertThat(provider.createCalls.get()).isZero();
    }

    @Test
    void aSaleAlreadyInvoicedIsRefusedAndNotStampedAgain() throws Exception {
        UUID sale = seedSale(tenant);
        assertThat(send(tenant, "owner", body(sale, validReceiver())).getResponse().getStatus()).isEqualTo(201);

        MvcResult second = send(tenant, "owner", body(sale, validReceiver()));

        assertThat(second.getResponse().getStatus()).isEqualTo(409);
        assertThat(second.getResponse().getContentAsString()).contains("fiscalUuid");
        assertThat(provider.createCalls.get()).isOne();
        assertThat(count("invoice", tenant)).isOne();
    }

    @Test
    void theDatabaseItselfRefusesASecondInvoiceForTheSameSale() {
        UUID sale = seedSale(tenant);
        String insert = "INSERT INTO invoice (tenant_id, id, sale_id, status, receiver_tax_id) VALUES (?, ?, ?, 'pending', ?)";
        admin.update(insert, tenant, Uuid7.next(), sale, RFC);

        assertThatThrownBy(() -> admin.update(insert, tenant, Uuid7.next(), sale, RFC))
                .isInstanceOf(DataAccessException.class).hasMessageContaining("invoice_one_per_sale");
    }

    @Test
    void aRejectionLeavesTheInvoiceFailedAndTheFixedRequestStampsWithoutLookingUp() throws Exception {
        UUID sale = seedSale(tenant);
        provider.mode = FakeFiscalInvoicing.Mode.REJECT;

        MvcResult rejected = send(tenant, "owner", body(sale, validReceiver()));

        assertThat(rejected.getResponse().getStatus()).isEqualTo(422);
        assertThat(rejected.getResponse().getContentAsString()).contains("provider_rejected");
        Map<String, Object> failed = admin.queryForMap("SELECT * FROM invoice WHERE sale_id = ?", sale);
        assertThat(failed).containsEntry("status", "failed").containsEntry("error_code", "provider_rejected")
                .containsEntry("provider_http_status", 400);
        assertThat(failed.get("fiscal_uuid")).isNull();
        assertThat(admin.queryForObject("SELECT count(*) FROM audit_log WHERE tenant_id = ? AND action = 'invoice.failed'",
                Long.class, tenant)).isOne();

        provider.mode = FakeFiscalInvoicing.Mode.SUCCEED;
        assertThat(send(tenant, "owner", body(sale, validReceiver())).getResponse().getStatus()).isEqualTo(201);

        assertThat(provider.lookupCalls.get()).as("a 4xx cannot have stamped, so there is nothing to look up").isZero();
        assertThat(admin.queryForMap("SELECT status, attempts FROM invoice WHERE sale_id = ?", sale))
                .containsEntry("status", "stamped").containsEntry("attempts", 2);
        assertThat(count("invoice", tenant)).isOne();
    }

    @Test
    void aLostAnswerLeavesItPendingAndTheRetryFindsTheStampedInvoiceInsteadOfStampingTwice() throws Exception {
        UUID sale = seedSale(tenant);
        provider.mode = FakeFiscalInvoicing.Mode.STAMP_THEN_TIME_OUT;

        MvcResult timedOut = send(tenant, "owner", body(sale, validReceiver()));

        assertThat(timedOut.getResponse().getStatus()).isEqualTo(503);
        assertThat(timedOut.getResponse().getContentAsString()).contains("outcome_unknown");
        assertThat(admin.queryForMap("SELECT status, error_code FROM invoice WHERE sale_id = ?", sale))
                .containsEntry("status", "pending").containsEntry("error_code", "provider_unavailable");

        provider.mode = FakeFiscalInvoicing.Mode.SUCCEED;
        MvcResult retry = send(tenant, "owner", body(sale, validReceiver()));

        assertThat(retry.getResponse().getStatus()).isEqualTo(201);
        assertThat(provider.lookupCalls.get()).isOne();
        assertThat(provider.createCalls.get()).as("the retry did not stamp again").isOne();
        assertThat(admin.queryForObject("SELECT status FROM invoice WHERE sale_id = ?", String.class, sale)).isEqualTo("stamped");
        assertThat(admin.queryForObject("SELECT new_value->>'recovered' FROM audit_log WHERE tenant_id = ? AND action = 'invoice.stamped'",
                String.class, tenant)).isEqualTo("true");
    }

    @Test
    void aServerErrorBeforeStampingIsCheckedAndThenStampedOnce() throws Exception {
        UUID sale = seedSale(tenant);
        provider.mode = FakeFiscalInvoicing.Mode.FAIL_WITHOUT_STAMPING;
        assertThat(send(tenant, "owner", body(sale, validReceiver())).getResponse().getStatus()).isEqualTo(503);
        assertThat(admin.queryForMap("SELECT provider_http_status FROM invoice WHERE sale_id = ?", sale))
                .containsEntry("provider_http_status", 503);

        provider.mode = FakeFiscalInvoicing.Mode.SUCCEED;
        assertThat(send(tenant, "owner", body(sale, validReceiver())).getResponse().getStatus()).isEqualTo(201);

        assertThat(provider.lookupCalls.get()).isOne();
        assertThat(provider.createCalls.get()).isEqualTo(2);
        assertThat(count("invoice", tenant)).isOne();
    }

    @Test
    void ifTheLookupBeforeARetryFailsNothingIsStamped() throws Exception {
        UUID sale = seedSale(tenant);
        provider.mode = FakeFiscalInvoicing.Mode.STAMP_THEN_TIME_OUT;
        send(tenant, "owner", body(sale, validReceiver()));
        provider.mode = FakeFiscalInvoicing.Mode.SUCCEED;
        provider.lookupFails = true;

        assertThat(send(tenant, "owner", body(sale, validReceiver())).getResponse().getStatus()).isEqualTo(503);

        assertThat(provider.createCalls.get()).isOne();
        assertThat(admin.queryForObject("SELECT status FROM invoice WHERE sale_id = ?", String.class, sale)).isEqualTo("pending");
    }

    @Test
    void withoutAnApiKeyTheInvoiceFailsWithoutStamping() throws Exception {
        UUID sale = seedSale(tenant);
        provider.mode = FakeFiscalInvoicing.Mode.NOT_CONFIGURED;

        MvcResult result = send(tenant, "owner", body(sale, validReceiver()));

        assertThat(result.getResponse().getStatus()).isEqualTo(503);
        assertThat(result.getResponse().getContentAsString()).contains("provider_not_configured");
        assertThat(admin.queryForMap("SELECT status, error_code FROM invoice WHERE sale_id = ?", sale))
                .containsEntry("status", "failed").containsEntry("error_code", "provider_not_configured");
    }

    @Test
    void manyRequestsForTheSameSaleStampItOnce() throws Exception {
        UUID sale = seedSale(tenant);
        provider.createDelayMillis = 400;
        int threads = 8;
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        CountDownLatch go = new CountDownLatch(1);
        List<Future<String>> outcomes = new ArrayList<>();
        for (int i = 0; i < threads; i++) {
            Callable<String> request = () -> {
                go.await();
                return TenantContext.callAs(tenant, () -> attempt(sale));
            };
            outcomes.add(pool.submit(request));
        }
        go.countDown();
        List<String> results = new ArrayList<>();
        for (Future<String> outcome : outcomes) {
            results.add(outcome.get(30, TimeUnit.SECONDS));
        }
        pool.shutdown();

        assertThat(results.stream().filter("stamped"::equals)).hasSize(1);
        assertThat(results.stream().filter(r -> !r.equals("stamped"))).hasSize(threads - 1)
                .allMatch(r -> r.equals("in_progress") || r.equals("already_invoiced"));
        assertThat(provider.createCalls.get()).isOne();
        assertThat(count("invoice", tenant)).isOne();
    }

    @Test
    void businessesAreKeptApart() {
        UUID sale = seedSale(tenant);
        TenantContext.runAs(tenant, () -> service.issue(command(sale)));

        // The application role sees rows only inside a transaction that pinned a business (ADR 0035).
        Long seenByOther = TenantContext.callAs(otherTenant,
                () -> transaction.execute(status -> app.queryForObject("SELECT count(*) FROM invoice", Long.class)));
        Long seenByOwner = TenantContext.callAs(tenant,
                () -> transaction.execute(status -> app.queryForObject("SELECT count(*) FROM invoice", Long.class)));

        assertThat(seenByOther).isZero();
        assertThat(seenByOwner).isOne();
        assertThatThrownBy(() -> TenantContext.runAs(otherTenant, () -> service.issue(command(sale))))
                .isInstanceOf(SaleNotFoundException.class);
    }

    @Test
    void onlyOwnersAndManagersMayInvoice() throws Exception {
        UUID sale = seedSale(tenant);

        assertThat(send(tenant, "cashier", body(sale, validReceiver())).getResponse().getStatus()).isEqualTo(403);
        assertThat(count("invoice", tenant)).isZero();
        assertThat(send(tenant, "manager", body(sale, validReceiver())).getResponse().getStatus()).isEqualTo(201);
        assertThat(mvc.perform(post("/invoices").contentType(MediaType.APPLICATION_JSON).content("{}")).andReturn()
                .getResponse().getStatus()).isEqualTo(401);
    }

    @Test
    void neitherTheRfcNorTheNameReachTheLogs() throws Exception {
        UUID sale = seedSale(tenant);
        provider.mode = FakeFiscalInvoicing.Mode.REJECT;
        send(tenant, "owner", body(sale, validReceiver()));
        provider.mode = FakeFiscalInvoicing.Mode.STAMP_THEN_TIME_OUT;
        UUID second = seedSale(tenant);
        send(tenant, "owner", body(second, validReceiver()));
        provider.mode = FakeFiscalInvoicing.Mode.SUCCEED;
        send(tenant, "owner", body(second, validReceiver()));

        assertThat(logs.list).isNotEmpty();
        assertThat(logs.list).extracting(ILoggingEvent::getFormattedMessage)
                .noneMatch(message -> message.contains(RFC) || message.contains(LEGAL_NAME) || message.contains("64000"));
    }

    // --- helpers ----------------------------------------------------------------------------------------------

    private String attempt(UUID sale) {
        try {
            service.issue(command(sale));
            return "stamped";
        } catch (SaleAlreadyInvoicedException duplicate) {
            return "already_invoiced";
        } catch (InvoiceInProgressException busy) {
            return "in_progress";
        } catch (InvoiceNotIssuedException failure) {
            return "not_issued";
        }
    }

    private static IssueInvoiceCommand command(UUID sale) {
        return new IssueInvoiceCommand(sale, new Receiver(LEGAL_NAME, RFC, "601", "G03", "64000", null), null, null, Uuid7.next());
    }

    private MvcResult send(UUID business, String role, ObjectNode body) throws Exception {
        return mvc.perform(post("/invoices").with(token(business, role)).contentType(MediaType.APPLICATION_JSON)
                .content(body.toString())).andReturn();
    }

    private static ObjectNode body(UUID sale, ObjectNode receiver) {
        ObjectNode body = JSON.createObjectNode();
        body.put("saleId", sale.toString());
        body.set("receiver", receiver);
        return body;
    }

    private static ObjectNode validReceiver() {
        ObjectNode receiver = JSON.createObjectNode();
        receiver.put("legalName", LEGAL_NAME).put("taxId", RFC).put("taxRegime", "601").put("cfdiUse", "G03")
                .put("zipCode", "64000");
        return receiver;
    }

    private JwtRequestPostProcessor token(UUID business, String role) {
        String subject = role + "-" + business;
        admin.update("INSERT INTO app_user (id, tenant_id, display_name, role, keycloak_subject) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING",
                Uuid7.next(), business, role, role, subject);
        return jwt().jwt(token -> token.subject(subject).claim("tenant_id", business.toString()));
    }

    private void seedTenant(UUID business) {
        admin.update("INSERT INTO tenant (id, name) VALUES (?, 'Test business') ON CONFLICT DO NOTHING", business);
    }

    /** A sale of 3 meters of cable worth $116.00 with VAT, paid in cash (as the register would send it). */
    private UUID seedSale(UUID business) {
        UUID sale = Uuid7.next();
        admin.update("""
                INSERT INTO sale (tenant_id, id, op_id, register_id, folio, completed_at, subtotal_cents, tax_cents, total_cents)
                VALUES (?, ?, ?, ?, 87, now(), 10000, 1600, 11600)""", business, sale, Uuid7.next(), Uuid7.next());
        admin.update("""
                INSERT INTO sale_line (tenant_id, id, sale_id, line_number, product_id, product_name, unit, quantity_milli,
                                       unit_price_e4, tax_factor, tax_rate_bp, subtotal_cents, tax_cents, line_total_cents)
                VALUES (?, ?, ?, 1, ?, 'Cable THW', 'meter', 3000, 386667, 'rate', 1600, 10000, 1600, 11600)""",
                business, Uuid7.next(), sale, Uuid7.next());
        admin.update("INSERT INTO sale_payment (tenant_id, id, sale_id, method, amount_cents) VALUES (?, ?, ?, 'cash', 11600)",
                business, Uuid7.next(), sale);
        return sale;
    }

    private long count(String table, UUID business) {
        Long count = admin.queryForObject("SELECT count(*) FROM " + table + " WHERE tenant_id = ?", Long.class, business);
        return count == null ? 0 : count;
    }

    /** The fake provider replaces the real client, and the pool is wide enough for real concurrency. */
    @TestConfiguration(proxyBeanMethods = false)
    static class FakeProvider {

        @Bean
        @Primary
        FakeFiscalInvoicing fakeFiscalInvoicing() {
            return new FakeFiscalInvoicing();
        }

        @Bean
        DynamicPropertyRegistrar widePool() {
            return registry -> registry.add("spring.datasource.hikari.maximum-pool-size", () -> 12);
        }
    }
}
