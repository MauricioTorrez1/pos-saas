package io.github.mauriciotorrez1.pos.core.catalog;

import static org.assertj.core.api.Assertions.assertThat;

import com.networknt.schema.Schema;
import com.networknt.schema.SchemaLocation;
import com.networknt.schema.SchemaRegistry;
import com.networknt.schema.SpecificationVersion;
import io.github.mauriciotorrez1.pos.core.identity.Role;
import io.github.mauriciotorrez1.pos.money.LineTotals;
import io.github.mauriciotorrez1.pos.money.Quantity;
import io.github.mauriciotorrez1.pos.money.TaxRate;
import io.github.mauriciotorrez1.pos.money.Unit;
import io.github.mauriciotorrez1.pos.money.UnitPrice;
import io.github.mauriciotorrez1.pos.security.SecuredApiTest;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Price, tax and SAT keys of a product through the real API with real Keycloak tokens (F0-17, RF-003, RF-004,
 * RF-008, RF-040): prices with VAT included at every rate, invalid SAT keys, the cashier turned away and audited,
 * the append-only price history, the report of products that cannot be invoiced, and what registers pull.
 */
class ProductPricingApiTest extends SecuredApiTest {

    private static final Schema PULL_SCHEMA = SchemaRegistry.withDefaultDialect(SpecificationVersion.DRAFT_2020_12)
            .getSchema(SchemaLocation.of("classpath:contracts/schemas/sync-pull-response.schema.json"));

    @Autowired
    private JsonMapper json;

    private UUID tenant;
    private Actor owner;
    private Actor manager;
    private Actor cashier;

    @BeforeAll
    void seed() {
        tenant = seedTenant();
        owner = seedActor(tenant, Role.OWNER, true);
        manager = seedActor(tenant, Role.MANAGER, true);
        cashier = seedActor(tenant, Role.CASHIER, true);
    }

    private record Reply(int status, JsonNode body) {
    }

    private Reply call(Actor actor, HttpMethod method, String path, Object body, UUID idempotencyKey) {
        var request = client.method(method).uri(path).header("Authorization", actor.bearer());
        if (idempotencyKey != null) {
            request = request.header("Idempotency-Key", idempotencyKey.toString());
        }
        var result = (body == null ? request.exchange() : request.contentType(MediaType.APPLICATION_JSON)
                .body(body instanceof String text ? text : json.writeValueAsString(body)).exchange())
                .expectBody(String.class).returnResult();
        String text = result.getResponseBody();
        return new Reply(result.getStatus().value(), text == null || text.isBlank() ? null : json.readTree(text));
    }

    private Reply create(Actor actor, Map<String, Object> fields) {
        Map<String, Object> body = new HashMap<>(Map.of("name", "Producto " + UUID.randomUUID().toString().substring(0, 8),
                "unit", "piece"));
        body.putAll(fields);
        return call(actor, HttpMethod.POST, "/products", body, UUID.randomUUID());
    }

    private UUID createdId(Reply reply) {
        assertThat(reply.status()).as("create status, body %s", reply.body()).isEqualTo(201);
        return UUID.fromString(reply.body().get("id").asString());
    }

    // -- price with VAT included -------------------------------------------------------------------------------

    @Test
    void aPriceWithVatIncludedSplitsIntoBaseAndTaxAtEveryRate() {
        record Case(String price, String factor, Integer rateBp, long subtotalCents, long taxCents) {
        }
        List<Case> cases = List.of(
                new Case("116.0000", "rate", 1600, 10_000, 1_600),
                new Case("108.0000", "rate", 800, 10_000, 800),
                new Case("100.0000", "rate", 0, 10_000, 0),
                new Case("100.0000", "exempt", null, 10_000, 0));
        for (Case c : cases) {
            Map<String, Object> fields = new HashMap<>(Map.of("unitPrice", c.price(), "taxFactor", c.factor()));
            if (c.rateBp() != null) {
                fields.put("taxRateBp", c.rateBp());
            }

            Reply reply = create(owner, fields);

            UUID id = createdId(reply);
            assertThat(reply.body().get("unitPrice").asString()).isEqualTo(c.price());
            assertThat(admin.queryForObject("SELECT unit_price_e4 FROM product WHERE id = ?", Long.class, id))
                    .isEqualTo(UnitPrice.parse(c.price()).e4());
            // The register splits a one-piece line with the same rule the core uses (ADR 0023).
            TaxRate rate = c.factor().equals("exempt") ? TaxRate.EXEMPT : TaxRate.of(c.rateBp());
            LineTotals line = LineTotals.of(UnitPrice.parse(reply.body().get("unitPrice").asString()),
                    Quantity.parse("1", Unit.PIECE), rate);
            assertThat(line.subtotal().cents()).isEqualTo(c.subtotalCents());
            assertThat(line.tax().cents()).isEqualTo(c.taxCents());
        }
    }

    @Test
    void aProductStartsAtZeroWithSixteenPercentAndNoSatKeys() {
        Reply reply = create(manager, Map.of());

        createdId(reply);
        assertThat(reply.body().get("unitPrice").asString()).isEqualTo("0.0000");
        assertThat(reply.body().get("taxFactor").asString()).isEqualTo("rate");
        assertThat(reply.body().get("taxRateBp").asInt()).isEqualTo(1600);
        assertThat(reply.body().get("invoiceable").asBoolean()).isFalse();
    }

    @Test
    void invalidPricesAndTaxRatesAreRefused() {
        assertThat(create(owner, Map.of("unitPrice", "12.50000")).status()).as("5 decimals").isEqualTo(400);
        assertThat(create(owner, Map.of("unitPrice", "-1")).status()).isEqualTo(400);
        assertThat(create(owner, Map.of("unitPrice", "abc")).status()).isEqualTo(400);
        assertThat(create(owner, Map.of("taxRateBp", 1200)).status()).as("12% is not offered").isEqualTo(400);
        assertThat(create(owner, Map.of("taxFactor", "exempt", "taxRateBp", 1600)).status()).isEqualTo(400);
        assertThat(create(owner, Map.of("taxFactor", "free")).status()).isEqualTo(400);
    }

    // -- SAT keys ----------------------------------------------------------------------------------------------

    @Test
    void satKeysAreCheckedForFormatAndAgainstTheReviewedFiles() {
        assertThat(create(owner, Map.of("satProductKey", "1234")).status()).as("format").isEqualTo(400);
        assertThat(create(owner, Map.of("satProductKey", "ABCDEFGH")).status()).as("format").isEqualTo(400);
        assertThat(create(owner, Map.of("satProductKey", "99999999")).status()).as("not in the file").isEqualTo(400);
        assertThat(create(owner, Map.of("satUnitKey", "h87")).status()).as("lower case").isEqualTo(400);
        assertThat(create(owner, Map.of("satUnitKey", "ZZZ")).status()).as("not in the file").isEqualTo(400);

        Reply valid = create(owner, Map.of("satProductKey", "01010101", "satUnitKey", "H87"));

        createdId(valid);
        assertThat(valid.body().get("satProductKey").asString()).isEqualTo("01010101");
        assertThat(valid.body().get("invoiceable").asBoolean()).isTrue();
    }

    @Test
    void aSatKeyCanBeAddedLaterAndCleared() {
        UUID id = createdId(create(manager, Map.of()));

        Reply withUnit = call(manager, HttpMethod.PATCH, "/products/" + id, Map.of("satUnitKey", "MTR"), null);
        Reply invalid = call(manager, HttpMethod.PATCH, "/products/" + id, Map.of("satProductKey", "12"), null);
        Reply complete = call(manager, HttpMethod.PATCH, "/products/" + id, Map.of("satProductKey", "01010101"), null);
        Reply cleared = call(manager, HttpMethod.PATCH, "/products/" + id, Map.of("satUnitKey", ""), null);

        assertThat(withUnit.body().get("invoiceable").asBoolean()).isFalse();
        assertThat(invalid.status()).isEqualTo(400);
        assertThat(complete.body().get("invoiceable").asBoolean()).isTrue();
        assertThat(cleared.body().get("satUnitKey").isNull()).isTrue();
        assertThat(cleared.body().get("invoiceable").asBoolean()).isFalse();
    }

    @Test
    void theFiscalPendingReportListsOnlyLiveProductsWithoutBothKeys() {
        UUID reportTenant = seedTenant();
        Actor reportOwner = seedActor(reportTenant, Role.OWNER, true);
        Actor reportCashier = seedActor(reportTenant, Role.CASHIER, true);
        createdId(create(reportOwner, Map.of("name", "Completo", "satProductKey", "01010101", "satUnitKey", "H87")));
        createdId(create(reportOwner, Map.of("name", "Sin unidad", "satProductKey", "01010101")));
        createdId(create(reportOwner, Map.of("name", "Sin nada")));
        UUID removed = createdId(create(reportOwner, Map.of("name", "Borrado")));
        call(reportOwner, HttpMethod.DELETE, "/products/" + removed, null, null);

        Reply report = call(reportOwner, HttpMethod.GET, "/reports/fiscal-pending", null, null);

        assertThat(report.status()).isEqualTo(200);
        assertThat(report.body().get("total").asInt()).isEqualTo(2);
        List<String> names = new ArrayList<>();
        report.body().get("items").forEach(item -> names.add(item.get("name").asString()));
        assertThat(names).containsExactly("Sin nada", "Sin unidad");
        assertThat(call(reportCashier, HttpMethod.GET, "/reports/fiscal-pending", null, null).status()).isEqualTo(403);
    }

    // -- who may change a price, history and audit -------------------------------------------------------------

    @Test
    void aCashierCannotChangeAPriceAndTheAttemptIsAudited() {
        UUID id = createdId(create(owner, Map.of("unitPrice", "10.0000")));

        assertThat(call(cashier, HttpMethod.PATCH, "/products/" + id + "/price", Map.of("unitPrice", "1.0000"), null).status())
                .isEqualTo(403);

        assertThat(admin.queryForObject("SELECT unit_price_e4 FROM product WHERE id = ?", Long.class, id)).isEqualTo(100_000L);
        assertThat(admin.queryForObject("""
                SELECT count(*) FROM audit_log WHERE tenant_id = ? AND actor_id = ? AND action = 'access.denied'
                  AND new_value->>'permission' = 'price.change'
                """, Long.class, tenant, cashier.id())).isPositive();
    }

    @Test
    void aManagerCannotChangeAPriceNorCreateAProductWithOne() {
        UUID id = createdId(create(owner, Map.of("unitPrice", "10.0000")));

        assertThat(call(manager, HttpMethod.PATCH, "/products/" + id + "/price", Map.of("unitPrice", "1.0000"), null).status())
                .isEqualTo(403);
        assertThat(create(manager, Map.of("unitPrice", "5.0000")).status()).isEqualTo(403);
        assertThat(call(manager, HttpMethod.PATCH, "/products/" + id, Map.of("unitPrice", "1.0000"), null).status())
                .as("the edit endpoint never changes a price").isEqualTo(400);
        assertThat(admin.queryForObject("SELECT unit_price_e4 FROM product WHERE id = ?", Long.class, id)).isEqualTo(100_000L);
    }

    @Test
    void theOwnerChangesAPriceAndItIsAuditedAndKeptInAnAppendOnlyHistory() {
        UUID id = createdId(create(owner, Map.of("unitPrice", "10.0000")));

        Reply raised = call(owner, HttpMethod.PATCH, "/products/" + id + "/price", Map.of("unitPrice", "11.5000"), null);
        Reply lowered = call(owner, HttpMethod.PATCH, "/products/" + id + "/price", Map.of("unitPrice", "9.2500"), null);
        Reply same = call(owner, HttpMethod.PATCH, "/products/" + id + "/price", Map.of("unitPrice", "9.2500"), null);

        assertThat(raised.body().get("unitPrice").asString()).isEqualTo("11.5000");
        assertThat(lowered.body().get("unitPrice").asString()).isEqualTo("9.2500");
        assertThat(same.status()).isEqualTo(200);
        List<Map<String, Object>> history = admin.queryForList("""
                SELECT previous_unit_price_e4 AS previous, new_unit_price_e4 AS current, changed_by, source
                FROM product_price_history WHERE product_id = ? ORDER BY changed_at, id
                """, id);
        assertThat(history).extracting(row -> row.get("current")).containsExactly(100_000L, 115_000L, 92_500L);
        assertThat(history).extracting(row -> row.get("previous")).containsExactly(null, 100_000L, 115_000L);
        assertThat(history).extracting(row -> row.get("source")).containsExactly("created", "panel", "panel");
        assertThat(history).extracting(row -> row.get("changed_by")).containsOnly(owner.id());
        List<Map<String, Object>> audit = admin.queryForList("""
                SELECT actor_id, old_value::text AS old_value, new_value::text AS new_value FROM audit_log
                WHERE entity_id = ? AND action = 'product.price_change' ORDER BY created_at
                """, id);
        assertThat(audit).hasSize(2);
        assertThat(audit.get(0).get("actor_id")).isEqualTo(owner.id());
        assertThat(audit.get(0).get("old_value").toString()).contains("100000");
        assertThat(audit.get(0).get("new_value").toString()).contains("115000");
    }

    @Test
    void theHistoryCannotBeEditedNorDeletedEvenByTheTableOwner() {
        UUID id = createdId(create(owner, Map.of("unitPrice", "10.0000")));

        org.assertj.core.api.Assertions.assertThatThrownBy(
                () -> admin.update("UPDATE product_price_history SET new_unit_price_e4 = 1 WHERE product_id = ?", id))
                .rootCause().hasMessageContaining("append-only");
        org.assertj.core.api.Assertions.assertThatThrownBy(
                () -> admin.update("DELETE FROM product_price_history WHERE product_id = ?", id))
                .rootCause().hasMessageContaining("append-only");
    }

    // -- what the registers pull -------------------------------------------------------------------------------

    private JsonNode pull(Actor actor, long cursor) {
        Reply reply = call(actor, HttpMethod.GET, "/sync/pull?cursor=" + cursor + "&limit=200", null, null);
        assertThat(reply.status()).isEqualTo(200);
        assertThat(PULL_SCHEMA.validate(reply.body())).as("the page follows the shared contract").isEmpty();
        return reply.body();
    }

    private static JsonNode lastChangeOf(JsonNode page, UUID id) {
        JsonNode found = null;
        for (JsonNode change : page.get("changes")) {
            if (change.get("entityId").asString().equals(id.toString())) {
                found = change;
            }
        }
        return found;
    }

    @Test
    void theRegisterPullsTheProductWithPriceTaxUnitAndCodesAndEveryChangeAfterIt() {
        UUID pullTenant = seedTenant();
        Actor pullOwner = seedActor(pullTenant, Role.OWNER, true);
        Actor pullCashier = seedActor(pullTenant, Role.CASHIER, true);
        String barcode = "75" + UUID.randomUUID().toString().substring(0, 8);
        Map<String, Object> fields = Map.of("name", "Cable THW 12", "unit", "meter", "unitPrice", "23.2000",
                "taxRateBp", 1600, "codes", List.of(Map.of("code", barcode, "kind", "barcode")));
        UUID id = createdId(call(pullOwner, HttpMethod.POST, "/products", fields, UUID.randomUUID()));

        JsonNode page = pull(pullCashier, 0);

        JsonNode payload = lastChangeOf(page, id).get("payload");
        assertThat(payload.get("name").asString()).isEqualTo("Cable THW 12");
        assertThat(payload.get("baseUnit").asString()).isEqualTo("meter");
        assertThat(payload.get("unitPriceE4").asLong()).isEqualTo(232_000L);
        assertThat(payload.get("taxFactor").asString()).isEqualTo("rate");
        assertThat(payload.get("taxRateBp").asInt()).isEqualTo(1600);
        assertThat(payload.get("barcodes").get(0).asString()).isEqualTo(barcode);

        long cursor = page.get("nextCursor").asLong();
        call(pullOwner, HttpMethod.PATCH, "/products/" + id + "/price", Map.of("unitPrice", "25.0000"), null);
        JsonNode afterPrice = pull(pullCashier, cursor);
        assertThat(lastChangeOf(afterPrice, id).get("payload").get("unitPriceE4").asLong()).isEqualTo(250_000L);

        cursor = afterPrice.get("nextCursor").asLong();
        call(pullOwner, HttpMethod.PATCH, "/products/" + id, Map.of("taxFactor", "exempt", "name", "Cable exento"), null);
        JsonNode afterEdit = pull(pullCashier, cursor);
        assertThat(lastChangeOf(afterEdit, id).get("payload").get("taxFactor").asString()).isEqualTo("exempt");
        assertThat(lastChangeOf(afterEdit, id).get("payload").get("taxRateBp").asInt()).isZero();

        cursor = afterEdit.get("nextCursor").asLong();
        call(pullOwner, HttpMethod.DELETE, "/products/" + id, null, null);
        JsonNode afterDelete = pull(pullCashier, cursor);
        assertThat(lastChangeOf(afterDelete, id).get("deleted").asBoolean()).isTrue();
    }

    @Test
    void anInactiveProductLeavesTheRegistersAndComesBackWhenReactivated() {
        UUID pullTenant = seedTenant();
        Actor pullOwner = seedActor(pullTenant, Role.OWNER, true);
        UUID id = createdId(call(pullOwner, HttpMethod.POST, "/products",
                Map.of("name", "Temporal", "unit", "piece", "unitPrice", "5.0000"), UUID.randomUUID()));

        call(pullOwner, HttpMethod.PATCH, "/products/" + id, Map.of("status", "inactive"), null);
        assertThat(lastChangeOf(pull(pullOwner, 0), id).get("deleted").asBoolean()).isTrue();

        call(pullOwner, HttpMethod.PATCH, "/products/" + id, Map.of("status", "active"), null);
        JsonNode back = lastChangeOf(pull(pullOwner, 0), id);
        assertThat(back.get("deleted").asBoolean()).isFalse();
        assertThat(back.get("payload").get("unitPriceE4").asLong()).isEqualTo(50_000L);
    }

    // -- prices that registers charged (E1-40) -----------------------------------------------------------------

    private Reply pushPriceChange(Actor actor, UUID registerId, UUID productId, long previous, long current) {
        Map<String, Object> payload = Map.of("changeId", io.github.mauriciotorrez1.pos.id.Uuid7.next().toString(),
                "productId", productId.toString(), "previousUnitPriceE4", previous, "newUnitPriceE4", current,
                "changedBy", actor.id().toString(), "authorizedBy", owner.id().toString());
        Map<String, Object> operation = Map.of("opId", io.github.mauriciotorrez1.pos.id.Uuid7.next().toString(), "deviceSeq", 1,
                "type", "product.price_changed", "schemaVersion", 1, "occurredAt", "2026-12-12T15:00:00.000Z",
                "payload", payload);
        return call(actor, HttpMethod.POST, "/sync/push", Map.of("registerId", registerId.toString(), "operations", List.of(operation)), null);
    }

    @Test
    void aPriceThatARegisterChargedIsAppliedToTheProductAndRepublished() {
        UUID priceTenant = seedTenant();
        Actor priceOwner = seedActor(priceTenant, Role.OWNER, true);
        Actor priceCashier = seedActor(priceTenant, Role.CASHIER, true);
        UUID id = createdId(call(priceOwner, HttpMethod.POST, "/products",
                Map.of("name", "Martillo", "unit", "piece", "unitPrice", "100.0000"), UUID.randomUUID()));
        long cursor = pull(priceCashier, 0).get("nextCursor").asLong();

        Reply pushed = pushPriceChange(priceCashier, io.github.mauriciotorrez1.pos.id.Uuid7.next(), id, 1_000_000, 1_200_000);

        assertThat(pushed.status()).isEqualTo(200);
        assertThat(pushed.body().get("results").get(0).get("status").asString()).isEqualTo("accepted");
        assertThat(call(priceOwner, HttpMethod.GET, "/products/" + id, null, null).body().get("unitPrice").asString())
                .isEqualTo("120.0000");
        assertThat(lastChangeOf(pull(priceCashier, cursor), id).get("payload").get("unitPriceE4").asLong()).isEqualTo(1_200_000L);
        List<Map<String, Object>> history = admin.queryForList(
                "SELECT new_unit_price_e4, source, changed_by FROM product_price_history WHERE product_id = ? ORDER BY changed_at, id", id);
        assertThat(history).extracting(row -> row.get("source")).containsExactly("created", "register");
        assertThat(history.get(1).get("changed_by")).isEqualTo(priceCashier.id());
        // The change is compared with the catalog price (RF-022): the register agreed with it, so no discrepancy.
        assertThat(admin.queryForObject("SELECT discrepancy FROM product_price_change WHERE product_id = ?", Boolean.class, id)).isFalse();
    }

    @Test
    void aRegisterPriceChangeFromAPriceThatTheCatalogDoesNotHoldIsMarkedAsDiscrepancy() {
        UUID priceTenant = seedTenant();
        Actor priceOwner = seedActor(priceTenant, Role.OWNER, true);
        Actor priceCashier = seedActor(priceTenant, Role.CASHIER, true);
        UUID id = createdId(call(priceOwner, HttpMethod.POST, "/products",
                Map.of("name", "Pala", "unit", "piece", "unitPrice", "100.0000"), UUID.randomUUID()));

        pushPriceChange(priceCashier, io.github.mauriciotorrez1.pos.id.Uuid7.next(), id, 900_000, 950_000);

        Map<String, Object> row = admin.queryForMap("SELECT discrepancy, server_price_e4 FROM product_price_change WHERE product_id = ?", id);
        assertThat(row).containsEntry("discrepancy", true).containsEntry("server_price_e4", 1_000_000L);
        // The register charged that price, so the catalog takes it; the owner sees the discrepancy to review it.
        assertThat(call(priceOwner, HttpMethod.GET, "/products/" + id, null, null).body().get("unitPrice").asString()).isEqualTo("95.0000");
    }

    @Test
    void aPriceChangeOfAnUnknownProductIsStillKeptAndTouchesNoProduct() {
        UUID priceTenant = seedTenant();
        Actor priceCashier = seedActor(priceTenant, Role.CASHIER, true);
        UUID unknown = io.github.mauriciotorrez1.pos.id.Uuid7.next();

        Reply pushed = pushPriceChange(priceCashier, io.github.mauriciotorrez1.pos.id.Uuid7.next(), unknown, 100, 200);

        assertThat(pushed.body().get("results").get(0).get("status").asString()).isEqualTo("accepted");
        assertThat(admin.queryForObject("SELECT count(*) FROM product_price_change WHERE product_id = ?", Long.class, unknown)).isEqualTo(1L);
        assertThat(admin.queryForObject("SELECT count(*) FROM product_price_history WHERE product_id = ?", Long.class, unknown)).isZero();
    }
}
