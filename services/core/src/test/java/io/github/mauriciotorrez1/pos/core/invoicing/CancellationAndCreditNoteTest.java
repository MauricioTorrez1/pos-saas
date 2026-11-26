package io.github.mauriciotorrez1.pos.core.invoicing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.jwt;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import io.github.mauriciotorrez1.pos.core.CoreApplication;
import io.github.mauriciotorrez1.pos.core.invoicing.FakeFiscalInvoicing.CancelMode;
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
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.JwtRequestPostProcessor;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Cancelling a CFDI (RF-037) and the credit note of a return (RF-038), ADR 0080: real PostgreSQL with row-level
 * security, the real HTTP layer and permissions, and a fake provider.
 */
@SpringBootTest(classes = CoreApplication.class, properties = {
        "invoicing.default-sat-product-key=27112700", "invoicing.issuer-zip-code=64000"})
@AutoConfigureMockMvc
@Import({PostgresTestConfiguration.class, CancellationAndCreditNoteTest.FakeProvider.class})
class CancellationAndCreditNoteTest {

    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final LocalDate OCTOBER_3 = LocalDate.of(2026, 10, 3);

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

    // --- cancellation of an individual invoice ------------------------------------------------------------------

    @Test
    void anAcceptedCancellationKeepsTheInvoiceAndLetsTheSaleBeInvoicedAgain() throws Exception {
        UUID sale = seedSale(tenant, OCTOBER_3, 11600);
        JsonNode invoice = invoice(sale, null);

        MvcResult cancelled = cancel("/invoices/" + invoice.get("invoiceId").asString(), "02", null, "owner");

        assertThat(cancelled.getResponse().getStatus()).isEqualTo(200);
        assertThat(body(cancelled).get("cancellationStatus").asString()).isEqualTo("accepted");
        assertThat(provider.cancelCalls).singleElement().satisfies(call -> {
            assertThat(call.invoiceId()).isEqualTo(invoice.get("providerInvoiceId").asString());
            assertThat(call.motive()).isEqualTo(CancellationMotive.WITHOUT_RELATED_DOCUMENT);
        });
        assertThat(admin.queryForObject("SELECT status || '/' || (superseded_at IS NOT NULL) FROM invoice WHERE sale_id = ?",
                String.class, sale)).as("nothing is deleted").isEqualTo("stamped/true");
        assertThat(admin.queryForList("SELECT action FROM audit_log WHERE tenant_id = ? AND action LIKE 'invoice.cancellation.%' ORDER BY created_at, id",
                String.class, tenant)).containsExactly("invoice.cancellation.requested", "invoice.cancellation.accepted");

        assertThat(issueInvoice(tenant, sale, null).getResponse().getStatus()).as("the corrected invoice").isEqualTo(201);
        assertThat(count("invoice", tenant)).isEqualTo(2);
    }

    @Test
    void aCancellationTheReceiverMustAcceptStaysPendingUntilRefreshed() throws Exception {
        UUID sale = seedSale(tenant, OCTOBER_3, 11600);
        String path = "/invoices/" + invoice(sale, null).get("invoiceId").asString();
        provider.cancelMode = CancelMode.PENDING;

        assertThat(body(cancel(path, "02", null, "owner")).get("cancellationStatus").asString()).isEqualTo("pending");
        assertThat(cancel(path, "03", null, "owner").getResponse().getContentAsString()).contains("awaiting_acceptance");
        assertThat(body(refresh(path)).get("cancellationStatus").asString()).as("nobody answered yet").isEqualTo("pending");

        provider.receiverAnswers(providerIdOf(sale), false);
        assertThat(body(refresh(path)).get("cancellationStatus").asString()).isEqualTo("rejected");
        assertThat(admin.queryForObject("SELECT superseded_at IS NULL FROM invoice WHERE sale_id = ?", Boolean.class, sale))
                .as("a refused cancellation leaves the invoice valid").isTrue();
        assertThat(issueInvoice(tenant, sale, null).getResponse().getStatus()).isEqualTo(409);

        provider.cancelMode = CancelMode.ACCEPT;
        assertThat(body(cancel(path, "02", null, "owner")).get("cancellationStatus").asString())
                .as("it may be asked again").isEqualTo("accepted");
    }

    @Test
    void theMotiveMustBeKnownAndAllowedForTheKindOfCfdi() throws Exception {
        UUID sale = seedSale(tenant, OCTOBER_3, 11600);
        String path = "/invoices/" + invoice(sale, null).get("invoiceId").asString();

        assertThat(cancel(path, "07", null, "owner").getResponse().getContentAsString()).contains("motive_unknown");
        assertThat(cancel(path, "04", null, "owner").getResponse().getContentAsString()).contains("motive_not_allowed");
        assertThat(cancel(path, "01", null, "owner").getResponse().getContentAsString()).contains("substitute_required");
        MvcResult notAReplacement = cancel(path, "01", UUID.randomUUID(), "owner");
        assertThat(notAReplacement.getResponse().getStatus()).isEqualTo(422);
        assertThat(notAReplacement.getResponse().getContentAsString()).contains("substitute_not_replacement");
        assertThat(provider.cancelCalls).isEmpty();
        assertThat(admin.queryForObject("SELECT cancellation_status FROM invoice WHERE sale_id = ?", String.class, sale)).isNull();
    }

    @Test
    void motive01StampsTheReplacementFirstAndThenCancelsTheOriginalWithIt() throws Exception {
        UUID sale = seedSale(tenant, OCTOBER_3, 11600);
        JsonNode original = invoice(sale, null);
        String originalId = original.get("invoiceId").asString();

        JsonNode replacement = body(issueInvoice(tenant, sale, UUID.fromString(originalId)));

        InvoiceDraft draft = provider.drafts.get(1);
        assertThat(draft.relationship()).isEqualTo("04");
        assertThat(draft.relatedInvoiceUuids()).containsExactly(original.get("fiscalUuid").asString());
        MvcResult cancelled = cancel("/invoices/" + originalId, "01", UUID.fromString(replacement.get("fiscalUuid").asString()), "owner");

        assertThat(body(cancelled).get("cancellationStatus").asString()).isEqualTo("accepted");
        assertThat(provider.cancelCalls.get(0).substituteInvoiceId()).isEqualTo(replacement.get("providerInvoiceId").asString());
        JsonNode list = body(mvc.perform(get("/invoices").with(token(tenant, "manager"))).andReturn());
        assertThat(list).hasSize(2);
        assertThat(list.get(0).get("replacesInvoiceId").asString()).isEqualTo(originalId);
        assertThat(list.get(0).get("superseded").asBoolean()).isFalse();
        assertThat(list.get(1).get("superseded").asBoolean()).isTrue();
        assertThat(issueInvoice(tenant, sale, UUID.fromString(originalId)).getResponse().getContentAsString())
                .as("a cancelled invoice is not replaced again").contains("not_replaceable");
    }

    @Test
    void aLostAnswerIsReadAtTheProviderBeforeAskingAgain() throws Exception {
        UUID sale = seedSale(tenant, OCTOBER_3, 11600);
        String path = "/invoices/" + invoice(sale, null).get("invoiceId").asString();
        provider.cancelMode = CancelMode.ACCEPT_THEN_TIME_OUT;

        MvcResult lost = cancel(path, "02", null, "owner");

        assertThat(lost.getResponse().getStatus()).isEqualTo(503);
        assertThat(lost.getResponse().getContentAsString()).contains("outcome_unknown");
        assertThat(admin.queryForObject("SELECT cancellation_status FROM invoice WHERE sale_id = ?", String.class, sale)).isEqualTo("requested");
        provider.cancelMode = CancelMode.ACCEPT;
        assertThat(body(cancel(path, "02", null, "owner")).get("cancellationStatus").asString()).isEqualTo("accepted");
        assertThat(provider.cancelCalls).as("not sent twice").hasSize(1);
        assertThat(provider.getCalls.get()).isOne();
    }

    @Test
    void aRefusedRequestIsRecordedAsFailedAndMayBeRepeated() throws Exception {
        UUID sale = seedSale(tenant, OCTOBER_3, 11600);
        String path = "/invoices/" + invoice(sale, null).get("invoiceId").asString();
        provider.cancelMode = CancelMode.REJECT;

        MvcResult refused = cancel(path, "03", null, "owner");

        assertThat(refused.getResponse().getStatus()).isEqualTo(422);
        assertThat(refused.getResponse().getContentAsString()).contains("provider_rejected", "providerMessage");
        assertThat(admin.queryForObject("SELECT cancellation_status FROM invoice WHERE sale_id = ?", String.class, sale)).isEqualTo("failed");
        provider.cancelMode = CancelMode.ACCEPT;
        assertThat(body(cancel(path, "03", null, "owner")).get("cancellationStatus").asString()).isEqualTo("accepted");
        assertThat(cancel(path, "03", null, "owner").getResponse().getContentAsString()).contains("already_cancelled");
    }

    // --- cancellation of a global invoice ------------------------------------------------------------------------

    @Test
    void motive04CancelsTheGlobalAndTheCorrectedGlobalLeavesOutTheInvoicedSale() throws Exception {
        UUID invoiced = seedSale(tenant, OCTOBER_3, 11600);
        UUID kept = seedSale(tenant, OCTOBER_3, 5800);
        String global = issueGlobal(tenant).get("id").asString();
        invoice(invoiced, null);

        assertThat(cancel("/invoices/" + global, "02", null, "owner").getResponse().getStatus())
                .as("an individual invoice path does not find a global").isEqualTo(404);
        assertThat(cancel("/invoices/global/" + global, "01", null, "owner").getResponse().getContentAsString()).contains("motive_not_allowed");
        MvcResult cancelled = cancel("/invoices/global/" + global, "04", null, "owner");

        assertThat(body(cancelled).get("cancellationStatus").asString()).isEqualTo("accepted");
        assertThat(admin.queryForObject("SELECT count(*) FROM global_invoice_sale WHERE global_invoice_id = ?::uuid AND released_at IS NULL",
                Long.class, global)).isZero();
        JsonNode corrected = issueGlobal(tenant);
        assertThat(corrected.get("saleCount").asInt()).isOne();
        assertThat(admin.queryForObject("SELECT sale_id FROM global_invoice_sale WHERE global_invoice_id = ?::uuid", UUID.class,
                corrected.get("id").asString())).isEqualTo(kept);
        JsonNode list = body(mvc.perform(get("/invoices/global").with(token(tenant, "owner"))).andReturn());
        assertThat(list.findValuesAsString("cancellationStatus")).contains("accepted");
    }

    // --- credit notes --------------------------------------------------------------------------------------------

    @Test
    void theReturnOfAnInvoicedSaleGetsACreditNoteToTheSameCustomerOnce() throws Exception {
        UUID sale = seedSale(tenant, OCTOBER_3, 11600);
        JsonNode invoice = invoice(sale, null);
        UUID returnId = seedReturn(tenant, sale, 5800, null);
        int customersBefore = provider.customerCalls.get();

        JsonNode candidates = body(mvc.perform(get("/invoices/credit-notes/candidates").with(token(tenant, "manager"))).andReturn());
        assertThat(candidates).singleElement().satisfies(candidate -> {
            assertThat(candidate.get("returnId").asString()).isEqualTo(returnId.toString());
            assertThat(candidate.get("target").asString()).isEqualTo("invoice");
        });
        MvcResult issued = creditNote(tenant, "manager", returnId);

        assertThat(issued.getResponse().getStatus()).isEqualTo(201);
        assertThat(body(issued).get("status").asString()).isEqualTo("stamped");
        InvoiceDraft draft = provider.drafts.get(1);
        assertThat(draft.type()).isEqualTo(InvoiceType.CREDIT_NOTE);
        assertThat(draft.relationship()).isEqualTo("01");
        assertThat(draft.relatedInvoiceUuids()).containsExactly(invoice.get("fiscalUuid").asString());
        assertThat(draft.cfdiUse()).isEqualTo("G02");
        assertThat(draft.customerId()).isEqualTo(provider.drafts.get(0).customerId());
        assertThat(provider.customerCalls.get()).as("the invoice's customer is reused").isEqualTo(customersBefore);
        assertThat(draft.lines()).singleElement().satisfies(line -> {
            assertThat(line.satProductKey()).isEqualTo("84111506");
            assertThat(line.unitPriceE4()).isEqualTo(580_000);
            assertThat(line.taxRateBasisPoints()).isEqualTo(1600);
        });

        assertThat(creditNote(tenant, "owner", returnId).getResponse().getContentAsString()).contains("already_issued");
        assertThat(body(mvc.perform(get("/invoices/credit-notes/candidates").with(token(tenant, "owner"))).andReturn())).isEmpty();
        assertThat(admin.queryForObject("SELECT count(*) FROM audit_log WHERE tenant_id = ? AND action = 'credit_note.stamped'",
                Long.class, tenant)).isOne();
    }

    @Test
    void aReturnAfterTheGlobalCorrectsTheGlobalAndOneBeforeWasAlreadyNettedOut() throws Exception {
        UUID early = seedSale(tenant, OCTOBER_3, 11600);
        UUID earlyReturn = seedReturn(tenant, early, 5800, "2026-10-05 12:00");
        UUID late = seedSale(tenant, OCTOBER_3, 11600);
        JsonNode global = issueGlobal(tenant);
        UUID lateReturn = seedReturn(tenant, late, 11600, null);

        MvcResult netted = creditNote(tenant, "owner", earlyReturn);
        MvcResult issued = creditNote(tenant, "owner", lateReturn);

        assertThat(netted.getResponse().getStatus()).isEqualTo(422);
        assertThat(netted.getResponse().getContentAsString()).contains("not_invoiced");
        assertThat(issued.getResponse().getStatus()).isEqualTo(201);
        assertThat(body(issued).get("target").asString()).isEqualTo("global_invoice");
        InvoiceDraft draft = provider.drafts.get(1);
        assertThat(draft.cfdiUse()).isEqualTo("S01");
        assertThat(draft.relatedInvoiceUuids()).containsExactly(global.get("fiscalUuid").asString());
        assertThat(provider.customers.get(provider.customers.size() - 1).taxId()).isEqualTo("XAXX010101000");
    }

    @Test
    void aLostCreditNoteIsLookedUpBeforeStampingAgain() throws Exception {
        UUID sale = seedSale(tenant, OCTOBER_3, 11600);
        invoice(sale, null);
        UUID returnId = seedReturn(tenant, sale, 11600, null);
        provider.mode = FakeFiscalInvoicing.Mode.STAMP_THEN_TIME_OUT;

        assertThat(creditNote(tenant, "owner", returnId).getResponse().getStatus()).isEqualTo(503);
        provider.mode = FakeFiscalInvoicing.Mode.SUCCEED;
        MvcResult retry = creditNote(tenant, "owner", returnId);

        assertThat(retry.getResponse().getStatus()).isEqualTo(201);
        assertThat(provider.createCalls.get()).as("the invoice and one credit note").isEqualTo(2);
        assertThat(admin.queryForObject("SELECT new_value->>'recovered' FROM audit_log WHERE tenant_id = ? AND action = 'credit_note.stamped'",
                String.class, tenant)).isEqualTo("true");
    }

    @Test
    void aReturnOfASaleWithoutCfdiHasNoCreditNote() throws Exception {
        UUID sale = seedSale(tenant, OCTOBER_3, 11600);
        UUID returnId = seedReturn(tenant, sale, 11600, null);

        MvcResult refused = creditNote(tenant, "owner", returnId);

        assertThat(refused.getResponse().getStatus()).isEqualTo(422);
        assertThat(refused.getResponse().getContentAsString()).contains("not_invoiced");
        assertThat(count("credit_note", tenant)).isZero();
    }

    // --- isolation and permissions -------------------------------------------------------------------------------

    @Test
    void businessesAreKeptApartAndOnlyTheOwnerCancels() throws Exception {
        UUID sale = seedSale(tenant, OCTOBER_3, 11600);
        String path = "/invoices/" + invoice(sale, null).get("invoiceId").asString();
        UUID returnId = seedReturn(tenant, sale, 5800, null);

        assertThat(cancel(path, "02", null, "manager").getResponse().getStatus()).isEqualTo(403);
        assertThat(mvc.perform(post(path + "/cancellation-refresh").with(token(tenant, "manager"))).andReturn()
                .getResponse().getStatus()).isEqualTo(403);
        assertThat(mvc.perform(get("/invoices").with(token(tenant, "cashier"))).andReturn().getResponse().getStatus()).isEqualTo(403);
        assertThat(creditNote(tenant, "cashier", returnId).getResponse().getStatus()).isEqualTo(403);

        assertThat(mvcCancelAs(otherTenant, path).getResponse().getStatus()).isEqualTo(404);
        assertThat(creditNote(otherTenant, "owner", returnId).getResponse().getStatus()).isEqualTo(404);
        assertThat(body(mvc.perform(get("/invoices").with(token(otherTenant, "owner"))).andReturn())).isEmpty();
        assertThat(provider.cancelCalls).isEmpty();
    }

    @Test
    void theDatabaseNeverLetsTheAppDeleteACreditNote() {
        assertThat(admin.queryForObject("SELECT has_table_privilege('pos_app', 'credit_note', 'DELETE')", Boolean.class)).isFalse();
        assertThat(admin.queryForObject("SELECT relforcerowsecurity FROM pg_class WHERE relname = 'credit_note'", Boolean.class)).isTrue();
    }

    // --- helpers ----------------------------------------------------------------------------------------------

    private JsonNode invoice(UUID sale, UUID replaces) throws Exception {
        MvcResult result = issueInvoice(tenant, sale, replaces);
        assertThat(result.getResponse().getStatus()).as(result.getResponse().getContentAsString()).isEqualTo(201);
        return body(result);
    }

    private MvcResult issueInvoice(UUID business, UUID sale, UUID replaces) throws Exception {
        ObjectNode request = JSON.createObjectNode();
        request.put("saleId", sale.toString());
        request.putObject("receiver").put("legalName", "ACME FERRETERIA SA").put("taxId", "ABC010203AB1")
                .put("taxRegime", "601").put("cfdiUse", "G03").put("zipCode", "64000");
        if (replaces != null) {
            request.put("replacesInvoiceId", replaces.toString());
        }
        return mvc.perform(post("/invoices").with(token(business, "owner")).contentType(MediaType.APPLICATION_JSON)
                .content(request.toString())).andReturn();
    }

    private JsonNode issueGlobal(UUID business) throws Exception {
        MvcResult result = mvc.perform(post("/invoices/global").with(token(business, "owner")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"periodicity\":\"monthly\",\"day\":\"2026-10-01\"}")).andReturn();
        assertThat(result.getResponse().getStatus()).as(result.getResponse().getContentAsString()).isEqualTo(201);
        return body(result);
    }

    private MvcResult cancel(String path, String motive, UUID substitute, String role) throws Exception {
        ObjectNode request = JSON.createObjectNode();
        request.put("motive", motive);
        if (substitute != null) {
            request.put("substituteFiscalUuid", substitute.toString());
        }
        return mvc.perform(post(path + "/cancel").with(token(tenant, role)).contentType(MediaType.APPLICATION_JSON)
                .content(request.toString())).andReturn();
    }

    private MvcResult mvcCancelAs(UUID business, String path) throws Exception {
        return mvc.perform(post(path + "/cancel").with(token(business, "owner")).contentType(MediaType.APPLICATION_JSON)
                .content("{\"motive\":\"02\"}")).andReturn();
    }

    private MvcResult refresh(String path) throws Exception {
        return mvc.perform(post(path + "/cancellation-refresh").with(token(tenant, "owner"))).andReturn();
    }

    private MvcResult creditNote(UUID business, String role, UUID returnId) throws Exception {
        return mvc.perform(post("/invoices/credit-notes").with(token(business, role)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"returnId\":\"" + returnId + "\"}")).andReturn();
    }

    private static JsonNode body(MvcResult result) throws Exception {
        return JSON.readTree(result.getResponse().getContentAsString());
    }

    private String providerIdOf(UUID sale) {
        return admin.queryForObject("SELECT provider_invoice_id FROM invoice WHERE sale_id = ? ORDER BY created_at LIMIT 1", String.class, sale);
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

    private long folioSequence = 500;

    /** A sale of one taxed line paid in cash on a business day. */
    private UUID seedSale(UUID business, LocalDate day, long totalCents) {
        UUID sale = Uuid7.next();
        long base = totalCents * 100 / 116;
        long tax = totalCents - base;
        admin.update("""
                INSERT INTO sale (tenant_id, id, op_id, register_id, folio, completed_at, business_date, subtotal_cents, tax_cents, total_cents)
                VALUES (?, ?, ?, ?, ?, ?::date + time '12:00', ?, ?, ?, ?)""",
                business, sale, Uuid7.next(), Uuid7.next(), ++folioSequence, day.toString(), day, base, tax, totalCents);
        admin.update("""
                INSERT INTO sale_line (tenant_id, id, sale_id, line_number, product_id, product_name, unit, quantity_milli,
                                       unit_price_e4, tax_factor, tax_rate_bp, subtotal_cents, tax_cents, line_total_cents)
                VALUES (?, ?, ?, 1, ?, 'Cable THW', 'piece', 1000, ?, 'rate', 1600, ?, ?, ?)""",
                business, Uuid7.next(), sale, Uuid7.next(), totalCents * 100, base, tax, totalCents);
        admin.update("INSERT INTO sale_payment (tenant_id, id, sale_id, method, amount_cents) VALUES (?, ?, ?, 'cash', ?)",
                business, Uuid7.next(), sale, totalCents);
        return sale;
    }

    /** A return of part of the only line, refunded in cash; {@code receivedAt} null means now. */
    private UUID seedReturn(UUID business, UUID sale, long refundCents, String receivedAt) {
        UUID returnId = Uuid7.next();
        admin.update("""
                INSERT INTO sale_return (tenant_id, id, op_id, sale_id, cash_session_id, requested_by, authorized_by, reason,
                                         total_cents, received_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'Defectuoso', ?, COALESCE(?::timestamptz, now()))""",
                business, returnId, Uuid7.next(), sale, Uuid7.next(), Uuid7.next(), Uuid7.next(), refundCents, receivedAt);
        UUID line = admin.queryForObject("SELECT id FROM sale_line WHERE sale_id = ? AND line_number = 1", UUID.class, sale);
        admin.update("INSERT INTO sale_return_line (tenant_id, id, return_id, sale_line_id, quantity_milli, refund_cents) VALUES (?, ?, ?, ?, 500, ?)",
                business, Uuid7.next(), returnId, line, refundCents);
        return returnId;
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
