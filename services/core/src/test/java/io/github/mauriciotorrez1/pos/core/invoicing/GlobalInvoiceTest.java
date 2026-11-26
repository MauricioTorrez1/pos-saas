package io.github.mauriciotorrez1.pos.core.invoicing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import io.github.mauriciotorrez1.pos.core.CoreApplication;
import io.github.mauriciotorrez1.pos.db.PostgresTestConfiguration;
import io.github.mauriciotorrez1.pos.id.Uuid7;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * The global invoice to the general public (E1-32, RF-036): real PostgreSQL with row-level security, the real HTTP
 * layer and permissions, and a fake provider. October 2026 is a closed period for these tests.
 */
@SpringBootTest(classes = CoreApplication.class, properties = {
        "invoicing.default-sat-product-key=27112700", "invoicing.issuer-zip-code=64000"})
@AutoConfigureMockMvc
@Import({PostgresTestConfiguration.class, GlobalInvoiceTest.FakeProvider.class})
class GlobalInvoiceTest {

    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final LocalDate OCTOBER_3 = LocalDate.of(2026, 10, 3);
    private static final LocalDate OCTOBER_20 = LocalDate.of(2026, 10, 20);

    @Autowired
    private MockMvc mvc;

    @Autowired
    private FakeFiscalInvoicing provider;

    @Autowired
    @Qualifier("adminJdbc")
    private JdbcTemplate admin;

    private final UUID tenant = Uuid7.next();
    private final UUID otherTenant = Uuid7.next();

    @BeforeEach
    void seed() {
        provider.reset();
        seedTenant(tenant);
        seedTenant(otherTenant);
    }

    @Test
    void thePreviewListsTheSalesNotInvoicedWithTheirTotalsPerRate() throws Exception {
        UUID plain = seedSale(tenant, OCTOBER_3, 11600, true);
        seedSale(tenant, OCTOBER_20, 5000, false);
        UUID invoiced = seedSale(tenant, OCTOBER_20, 11600, false);
        stampIndividually(tenant, invoiced);
        UUID returned = seedSale(tenant, OCTOBER_20, 11600, false);
        seedReturn(tenant, returned, 11600);
        seedSale(tenant, LocalDate.of(2026, 11, 2), 11600, false);
        seedSale(otherTenant, OCTOBER_3, 99900, false);

        JsonNode preview = preview(tenant, "monthly", "2026-10-15");

        assertThat(preview.get("periodStart").asString()).isEqualTo("2026-10-01");
        assertThat(preview.get("periodEnd").asString()).isEqualTo("2026-10-31");
        assertThat(preview.get("closed").asBoolean()).isTrue();
        assertThat(preview.get("deadline").asString()).isEqualTo("2026-11-03");
        assertThat(preview.get("saleCount").asInt()).as("the invoiced and the fully returned sales are out").isEqualTo(2);
        assertThat(preview.get("totalCents").asLong()).isEqualTo(11600 + 5000 + 5000);
        assertThat(preview.get("individuallyInvoiced").asLong()).isOne();
        assertThat(preview.get("paymentForm").asString()).isEqualTo("01");
        JsonNode sixteen = preview.get("byRate").get(0);
        assertThat(sixteen.get("taxRateBasisPoints").asInt()).isEqualTo(1600);
        assertThat(sixteen.get("totalCents").asLong()).isEqualTo(11600);
        assertThat(sixteen.get("baseCents").asLong()).isEqualTo(10000);
        assertThat(sixteen.get("taxCents").asLong()).isEqualTo(1600);
        JsonNode exempt = preview.get("byRate").get(1);
        assertThat(exempt.get("taxRateBasisPoints").isNull()).isTrue();
        assertThat(exempt.get("totalCents").asLong()).isEqualTo(10000);
        assertThat(preview.get("sales").get(0).get("saleId").asString()).isEqualTo(plain.toString());
        assertThat(provider.createCalls.get()).as("a preview stamps nothing").isZero();
    }

    @Test
    void stampsTheGlobalToTheGeneralPublicWithOneConceptPerTicketAndRate() throws Exception {
        UUID mixed = seedSale(tenant, OCTOBER_3, 11600, true);
        UUID second = seedSale(tenant, OCTOBER_20, 5000, false);

        MvcResult result = issue(tenant, "owner", request("monthly", "2026-10-31", 2));

        assertThat(result.getResponse().getStatus()).isEqualTo(201);
        JsonNode answer = JSON.readTree(result.getResponse().getContentAsString());
        assertThat(answer.get("status").asString()).isEqualTo("stamped");
        assertThat(answer.get("saleCount").asInt()).isEqualTo(2);
        assertThat(answer.get("fiscalUuid").isNull()).isFalse();

        FiscalCustomerData customer = provider.customers.get(0);
        assertThat(customer.taxId()).isEqualTo("XAXX010101000");
        assertThat(customer.legalName()).isEqualTo("PUBLICO EN GENERAL");
        assertThat(customer.taxSystem()).isEqualTo("616");
        assertThat(customer.zipCode()).isEqualTo("64000");
        InvoiceDraft draft = provider.drafts.get(0);
        assertThat(draft.cfdiUse()).isEqualTo("S01");
        assertThat(draft.globalPeriod()).isEqualTo(new GlobalPeriod("04", "10", 2026));
        assertThat(draft.externalId()).isEqualTo(answer.get("id").asString());
        assertThat(draft.lines()).hasSize(3).allSatisfy(line -> {
            assertThat(line.satProductKey()).isEqualTo("01010101");
            assertThat(line.satUnitKey()).isEqualTo("ACT");
            assertThat(line.quantityMilli()).isEqualTo(1000);
        });
        assertThat(draft.lines().get(0).identification()).isEqualTo(folioOf(mixed));
        assertThat(draft.lines().get(0).taxRateBasisPoints()).isEqualTo(1600);
        assertThat(draft.lines().get(1).taxRateBasisPoints()).as("the exempt part of the same ticket").isNull();
        assertThat(draft.lines().get(2).identification()).isEqualTo(folioOf(second));

        assertThat(admin.queryForList("SELECT sale_id FROM global_invoice_sale WHERE tenant_id = ?", UUID.class, tenant))
                .containsExactlyInAnyOrder(mixed, second);
        assertThat(admin.queryForObject("SELECT new_value->>'saleCount' FROM audit_log WHERE tenant_id = ? AND action = 'invoice.global.stamped'",
                String.class, tenant)).isEqualTo("2");
    }

    @Test
    void aPeriodIsStampedOnceAndASecondRequestGetsTheExistingGlobal() throws Exception {
        seedSale(tenant, OCTOBER_3, 11600, false);
        assertThat(issue(tenant, "owner", request("monthly", "2026-10-01", null)).getResponse().getStatus()).isEqualTo(201);

        MvcResult again = issue(tenant, "owner", request("monthly", "2026-10-31", null));

        assertThat(again.getResponse().getStatus()).isEqualTo(409);
        assertThat(again.getResponse().getContentAsString()).contains("already_issued", "fiscalUuid");
        assertThat(provider.createCalls.get()).isOne();
    }

    @Test
    void aSaleIsNeverInTwoLiveGlobalsAndTheDatabaseItselfRefusesIt() throws Exception {
        UUID sale = seedSale(tenant, OCTOBER_3, 11600, false);
        issue(tenant, "owner", request("monthly", "2026-10-01", null));
        UUID global = admin.queryForObject("SELECT id FROM global_invoice WHERE tenant_id = ?", UUID.class, tenant);

        assertThat(issue(tenant, "owner", request("daily", "2026-10-03", null)).getResponse().getContentAsString())
                .as("the daily global of the same day finds nothing left").contains("no_sales");
        assertThatThrownBy(() -> admin.update("INSERT INTO global_invoice_sale (tenant_id, global_invoice_id, sale_id, total_cents) VALUES (?, ?, ?, 1)",
                tenant, insertGlobal(tenant, "01", OCTOBER_3, "pending"), sale))
                .isInstanceOf(DataAccessException.class).hasMessageContaining("global_invoice_sale_once_idx");
        assertThat(global).isNotNull();
    }

    @Test
    void aLateSaleOfAPeriodAlreadyStampedGoesIntoTheNextGlobal() throws Exception {
        seedSale(tenant, OCTOBER_3, 11600, false);
        issue(tenant, "owner", request("monthly", "2026-10-01", null));
        UUID late = seedSale(tenant, OCTOBER_20, 5000, false);
        UUID unrelated = seedSale(tenant, LocalDate.of(2026, 9, 10), 7000, false);

        JsonNode november = preview(tenant, "monthly", "2026-11-01");

        assertThat(november.get("sales").findValuesAsString("saleId")).contains(late.toString()).doesNotContain(unrelated.toString());
    }

    @Test
    void aRejectionReleasesTheSalesAndAFixedRequestStampsThem() throws Exception {
        UUID sale = seedSale(tenant, OCTOBER_3, 11600, false);
        provider.mode = FakeFiscalInvoicing.Mode.REJECT;

        MvcResult rejected = issue(tenant, "owner", request("monthly", "2026-10-01", null));

        assertThat(rejected.getResponse().getStatus()).isEqualTo(422);
        assertThat(rejected.getResponse().getContentAsString()).contains("provider_rejected", "providerMessage");
        assertThat(admin.queryForObject("SELECT released_at IS NOT NULL FROM global_invoice_sale WHERE sale_id = ?", Boolean.class, sale)).isTrue();

        provider.mode = FakeFiscalInvoicing.Mode.SUCCEED;
        assertThat(issue(tenant, "owner", request("monthly", "2026-10-01", null)).getResponse().getStatus()).isEqualTo(201);
        assertThat(admin.queryForList("SELECT status FROM global_invoice WHERE tenant_id = ? ORDER BY created_at", String.class, tenant))
                .containsExactly("failed", "stamped");
    }

    @Test
    void aLostAnswerIsLookedUpBeforeStampingAgain() throws Exception {
        seedSale(tenant, OCTOBER_3, 11600, false);
        provider.mode = FakeFiscalInvoicing.Mode.STAMP_THEN_TIME_OUT;

        MvcResult timedOut = issue(tenant, "owner", request("monthly", "2026-10-01", null));

        assertThat(timedOut.getResponse().getStatus()).isEqualTo(503);
        assertThat(timedOut.getResponse().getContentAsString()).contains("outcome_unknown");
        provider.mode = FakeFiscalInvoicing.Mode.SUCCEED;
        MvcResult retry = issue(tenant, "owner", request("monthly", "2026-10-01", null));

        assertThat(retry.getResponse().getStatus()).isEqualTo(201);
        assertThat(provider.lookupCalls.get()).isOne();
        assertThat(provider.createCalls.get()).as("not stamped twice").isOne();
        assertThat(admin.queryForObject("SELECT new_value->>'recovered' FROM audit_log WHERE tenant_id = ? AND action = 'invoice.global.stamped'",
                String.class, tenant)).isEqualTo("true");
    }

    @Test
    void anOpenPeriodOrAStalePreviewStampsNothing() throws Exception {
        seedSale(tenant, OCTOBER_3, 11600, false);
        String future = LocalDate.now().plusDays(1).toString();

        MvcResult open = issue(tenant, "owner", request("daily", future, null));
        MvcResult stale = issue(tenant, "owner", request("monthly", "2026-10-01", 5));

        assertThat(open.getResponse().getStatus()).isEqualTo(422);
        assertThat(open.getResponse().getContentAsString()).contains("period_not_closed");
        assertThat(stale.getResponse().getStatus()).isEqualTo(409);
        assertThat(stale.getResponse().getContentAsString()).contains("preview_stale", "\"actualSaleCount\":1");
        assertThat(provider.createCalls.get()).isZero();
        assertThat(count("global_invoice", tenant)).isZero();
    }

    @Test
    void anUnknownPeriodicityOrDayIsRefused() throws Exception {
        assertThat(issue(tenant, "owner", request("weekly", "2026-10-01", null)).getResponse().getContentAsString())
                .contains("invalid_request", "periodicity");
        assertThat(issue(tenant, "owner", request("monthly", "octubre", null)).getResponse().getStatus()).isEqualTo(422);
    }

    @Test
    void aSaleInAStampedGlobalCanStillBeInvoicedAndTheGlobalIsFlaggedForMotive04() throws Exception {
        UUID sale = seedSale(tenant, OCTOBER_3, 11600, false);
        issue(tenant, "owner", request("monthly", "2026-10-01", null));
        UUID global = admin.queryForObject("SELECT id FROM global_invoice WHERE tenant_id = ?", UUID.class, tenant);

        MvcResult individual = mvc.perform(post("/invoices").with(token(tenant, "owner")).contentType(MediaType.APPLICATION_JSON)
                .content(individualBody(sale).toString())).andReturn();

        assertThat(individual.getResponse().getStatus()).isEqualTo(201);
        assertThat(admin.queryForObject("SELECT overlaps_global_invoice_id FROM invoice WHERE sale_id = ?", UUID.class, sale)).isEqualTo(global);
        assertThat(admin.queryForObject("SELECT new_value->>'overlapsGlobalInvoiceId' FROM audit_log WHERE tenant_id = ? AND action = 'invoice.stamped'",
                String.class, tenant)).isEqualTo(global.toString());
        JsonNode list = JSON.readTree(mvc.perform(get("/invoices/global").with(token(tenant, "manager"))).andReturn()
                .getResponse().getContentAsString());
        assertThat(list.get(0).get("overlappingInvoices").asLong()).isOne();
    }

    @Test
    void aSaleInAGlobalBeingStampedWaitsForIt() throws Exception {
        UUID sale = seedSale(tenant, OCTOBER_3, 11600, false);
        UUID global = insertGlobal(tenant, "04", LocalDate.of(2026, 10, 1), "pending");
        admin.update("INSERT INTO global_invoice_sale (tenant_id, global_invoice_id, sale_id, total_cents) VALUES (?, ?, ?, 11600)",
                tenant, global, sale);

        MvcResult individual = mvc.perform(post("/invoices").with(token(tenant, "owner")).contentType(MediaType.APPLICATION_JSON)
                .content(individualBody(sale).toString())).andReturn();

        assertThat(individual.getResponse().getStatus()).isEqualTo(409);
        assertThat(individual.getResponse().getContentAsString()).contains("in_pending_global");
        assertThat(count("invoice", tenant)).isZero();
    }

    @Test
    void businessesAreKeptApartAndOnlyOwnersAndManagersMayIssue() throws Exception {
        seedSale(otherTenant, OCTOBER_3, 11600, false);

        assertThat(preview(tenant, "monthly", "2026-10-01").get("saleCount").asInt()).isZero();
        assertThat(issue(tenant, "owner", request("monthly", "2026-10-01", null)).getResponse().getContentAsString()).contains("no_sales");
        assertThat(issue(otherTenant, "cashier", request("monthly", "2026-10-01", null)).getResponse().getStatus()).isEqualTo(403);
        assertThat(mvc.perform(get("/invoices/global/preview").param("day", "2026-10-01").with(token(otherTenant, "cashier")))
                .andReturn().getResponse().getStatus()).isEqualTo(403);
        assertThat(issue(otherTenant, "manager", request("monthly", "2026-10-01", null)).getResponse().getStatus()).isEqualTo(201);
        assertThat(count("global_invoice", tenant)).isZero();
    }

    // --- helpers ----------------------------------------------------------------------------------------------

    private JsonNode preview(UUID business, String periodicity, String day) throws Exception {
        MvcResult result = mvc.perform(get("/invoices/global/preview").param("periodicity", periodicity).param("day", day)
                .with(token(business, "owner"))).andReturn();
        assertThat(result.getResponse().getStatus()).isEqualTo(200);
        return JSON.readTree(result.getResponse().getContentAsString());
    }

    private MvcResult issue(UUID business, String role, ObjectNode body) throws Exception {
        return mvc.perform(post("/invoices/global").with(token(business, role)).contentType(MediaType.APPLICATION_JSON)
                .content(body.toString())).andReturn();
    }

    private static ObjectNode request(String periodicity, String day, Integer expectedSaleCount) {
        ObjectNode body = JSON.createObjectNode();
        body.put("periodicity", periodicity).put("day", day);
        if (expectedSaleCount != null) {
            body.put("expectedSaleCount", expectedSaleCount);
        }
        return body;
    }

    private static ObjectNode individualBody(UUID sale) {
        ObjectNode body = JSON.createObjectNode();
        body.put("saleId", sale.toString());
        body.putObject("receiver").put("legalName", "ACME FERRETERIA SA").put("taxId", "ABC010203AB1")
                .put("taxRegime", "601").put("cfdiUse", "G03").put("zipCode", "64000");
        return body;
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

    private long folioSequence = 100;

    /**
     * A sale paid in cash on a business day. With {@code withExemptLine} it also carries an exempt line of $50.00, so
     * one ticket has two tax treatments.
     */
    private UUID seedSale(UUID business, LocalDate day, long taxedTotalCents, boolean withExemptLine) {
        UUID sale = Uuid7.next();
        boolean exemptOnly = taxedTotalCents == 5000 && !withExemptLine;
        long base = exemptOnly ? 5000 : taxedTotalCents * 100 / 116;
        long tax = exemptOnly ? 0 : taxedTotalCents - base;
        long extra = withExemptLine ? 5000 : 0;
        admin.update("""
                INSERT INTO sale (tenant_id, id, op_id, register_id, folio, completed_at, business_date, subtotal_cents, tax_cents, total_cents)
                VALUES (?, ?, ?, ?, ?, ?::date + time '12:00', ?, ?, ?, ?)""",
                business, sale, Uuid7.next(), Uuid7.next(), ++folioSequence, day.toString(), day, base + extra, tax, taxedTotalCents + extra);
        admin.update("""
                INSERT INTO sale_line (tenant_id, id, sale_id, line_number, product_id, product_name, unit, quantity_milli,
                                       unit_price_e4, tax_factor, tax_rate_bp, subtotal_cents, tax_cents, line_total_cents)
                VALUES (?, ?, ?, 1, ?, 'Cable THW', 'piece', 1000, ?, ?, ?, ?, ?, ?)""",
                business, Uuid7.next(), sale, Uuid7.next(), taxedTotalCents * 100, exemptOnly ? "exempt" : "rate",
                exemptOnly ? 0 : 1600, base, tax, taxedTotalCents);
        if (withExemptLine) {
            admin.update("""
                    INSERT INTO sale_line (tenant_id, id, sale_id, line_number, product_id, product_name, unit, quantity_milli,
                                           unit_price_e4, tax_factor, tax_rate_bp, subtotal_cents, tax_cents, line_total_cents)
                    VALUES (?, ?, ?, 2, ?, 'Libro', 'piece', 1000, 500000, 'exempt', 0, 5000, 0, 5000)""",
                    business, Uuid7.next(), sale, Uuid7.next());
        }
        admin.update("INSERT INTO sale_payment (tenant_id, id, sale_id, method, amount_cents) VALUES (?, ?, ?, 'cash', ?)",
                business, Uuid7.next(), sale, taxedTotalCents + extra);
        return sale;
    }

    private void seedReturn(UUID business, UUID sale, long refundCents) {
        UUID returnId = Uuid7.next();
        admin.update("""
                INSERT INTO sale_return (tenant_id, id, op_id, sale_id, cash_session_id, requested_by, authorized_by, reason, total_cents)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'Defectuoso', ?)""",
                business, returnId, Uuid7.next(), sale, Uuid7.next(), Uuid7.next(), Uuid7.next(), refundCents);
        UUID line = admin.queryForObject("SELECT id FROM sale_line WHERE sale_id = ? AND line_number = 1", UUID.class, sale);
        admin.update("INSERT INTO sale_return_line (tenant_id, id, return_id, sale_line_id, quantity_milli, refund_cents) VALUES (?, ?, ?, ?, 1000, ?)",
                business, Uuid7.next(), returnId, line, refundCents);
    }

    private void stampIndividually(UUID business, UUID sale) {
        admin.update("""
                INSERT INTO invoice (tenant_id, id, sale_id, status, receiver_tax_id, provider_invoice_id, fiscal_uuid, total_cents)
                VALUES (?, ?, ?, 'stamped', 'ABC010203AB1', 'inv_x', ?, 11600)""", business, Uuid7.next(), sale, UUID.randomUUID());
    }

    private UUID insertGlobal(UUID business, String periodicity, LocalDate start, String status) {
        UUID id = Uuid7.next();
        admin.update("""
                INSERT INTO global_invoice (tenant_id, id, periodicity, period_start, period_end, sat_months, sat_year, status,
                                            payment_form, sale_count, expected_total_cents)
                VALUES (?, ?, ?, ?, ?, '10', 2026, ?, '01', 1, 11600)""",
                business, id, periodicity, start, "04".equals(periodicity) ? start.withDayOfMonth(start.lengthOfMonth()) : start, status);
        return id;
    }

    private String folioOf(UUID sale) {
        return admin.queryForObject("SELECT folio::text FROM sale WHERE id = ?", String.class, sale);
    }

    private long count(String table, UUID business) {
        Long count = admin.queryForObject("SELECT count(*) FROM " + table + " WHERE tenant_id = ?", Long.class, business);
        return count == null ? 0 : count;
    }

    /** The fake provider replaces the real client. */
    @TestConfiguration(proxyBeanMethods = false)
    static class FakeProvider {

        @Bean
        @Primary
        FakeFiscalInvoicing fakeFiscalInvoicing() {
            return new FakeFiscalInvoicing();
        }
    }
}
