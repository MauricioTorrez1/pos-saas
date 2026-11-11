package io.github.mauriciotorrez1.pos.core.catalog;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.mauriciotorrez1.pos.core.identity.Role;
import io.github.mauriciotorrez1.pos.security.SecuredApiTest;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * Products, codes and units through the real API with real Keycloak tokens (F0-16, RF-001, RF-002, RF-008):
 * the cable by the meter and the nail by the kilo, duplicate codes, search, logical delete, roles, isolation
 * between businesses, audit, the change feed, and the event in the outbox.
 */
class ProductCatalogApiTest extends SecuredApiTest {

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

    /** The answer of the API: status, parsed body and the raw text. */
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

    private Reply create(Actor actor, Map<String, ?> body) {
        return call(actor, HttpMethod.POST, "/products", body, UUID.randomUUID());
    }

    private static Map<String, Object> product(String name, String unit, List<Map<String, Object>> codes,
                                               List<Map<String, Object>> presentations) {
        return Map.of("name", name, "unit", unit, "codes", codes, "presentations", presentations);
    }

    private static Map<String, Object> code(String code, String kind) {
        return Map.of("code", code, "kind", kind);
    }

    private static String unique(String prefix) {
        return prefix + UUID.randomUUID().toString().substring(0, 8);
    }

    private UUID createdId(Reply reply) {
        assertThat(reply.status()).as("create status, body %s", reply.body()).isEqualTo(201);
        return UUID.fromString(reply.body().get("id").asString());
    }

    // -- the cable and the nail of the task card ---------------------------------------------------------------

    @Test
    void aCableSoldByTheMeterIsStoredWithItsRollAndTwoCodes() {
        String barcode = unique("750");
        String alternate = unique("CBL-");

        Reply reply = create(owner, product("Cable THW calibre 12", "meter",
                List.of(code(barcode, "barcode"), code(alternate, "alternate")),
                List.of(Map.of("name", "roll", "baseQuantity", "100.000"))));

        UUID id = createdId(reply);
        assertThat(UUID.fromString(id.toString()).version()).as("ids are UUIDv7 made by the core").isEqualTo(7);
        assertThat(reply.body().get("unit").asString()).isEqualTo("meter");
        assertThat(reply.body().get("unitKind").asString()).isEqualTo("length");
        assertThat(reply.body().get("status").asString()).isEqualTo("active");
        assertThat(reply.body().get("presentations").get(0).get("baseQuantity").asString()).isEqualTo("100.000");
        assertThat(admin.queryForObject("SELECT base_quantity_milli FROM product_presentation WHERE product_id = ?",
                Long.class, id)).isEqualTo(100_000L);

        // Scanning either code finds the same product (RF-001).
        for (String scanned : List.of(barcode, alternate)) {
            Reply found = call(cashier, HttpMethod.GET, "/products?q=" + scanned, null, null);
            assertThat(found.body().get("total").asInt()).isEqualTo(1);
            assertThat(found.body().get("items").get(0).get("id").asString()).isEqualTo(id.toString());
        }
    }

    @Test
    void aNailSoldByTheKiloAndAsSinglePiecesAreTwoProductsWithTheirOwnUnits() {
        UUID byKilo = createdId(create(manager, product("Clavo 2 pulgadas", "kilogram", List.of(code(unique("CK"), "barcode")),
                List.of(Map.of("name", "bag", "baseQuantity", "25")))));
        UUID byPiece = createdId(create(manager, product("Clavo de acero suelto", "piece", List.of(code(unique("CP"), "barcode")),
                List.of(Map.of("name", "box", "baseQuantity", "100")))));

        assertThat(call(owner, HttpMethod.GET, "/products/" + byKilo, null, null).body().get("unitKind").asString()).isEqualTo("weight");
        Reply piece = call(owner, HttpMethod.GET, "/products/" + byPiece, null, null);
        assertThat(piece.body().get("unitKind").asString()).isEqualTo("count");
        assertThat(piece.body().get("presentations").get(0).get("baseQuantity").asString()).isEqualTo("100.000");
    }

    @Test
    void aFractionOfAPieceOrMoreThanThreeDecimalsIsRefused() {
        assertThat(create(owner, product(unique("Clavo "), "piece", List.of(), List.of(Map.of("name", "half", "baseQuantity", "0.5")))).status())
                .isEqualTo(400);
        assertThat(create(owner, product(unique("Cable "), "meter", List.of(), List.of(Map.of("name", "roll", "baseQuantity", "1.2345")))).status())
                .isEqualTo(400);
        assertThat(create(owner, Map.of("name", unique("Tubo "), "unit", "yard")).status()).isEqualTo(400);
        assertThat(create(owner, Map.of("unit", "piece")).status()).isEqualTo(400);
    }

    // -- codes -------------------------------------------------------------------------------------------------

    @Test
    void aCodeCannotPointAtTwoProductsOfTheSameBusiness() {
        String shared = unique("DUP");
        UUID first = createdId(create(owner, product(unique("Primero "), "piece", List.of(code(shared, "barcode")), List.of())));
        long seqBefore = admin.queryForObject("SELECT last_seq FROM catalog_change_counter WHERE tenant_id = ?", Long.class, tenant);

        Reply second = create(owner, product(unique("Segundo "), "piece", List.of(code(unique("OTRO"), "barcode"), code(shared, "alternate")), List.of()));

        assertThat(second.status()).isEqualTo(409);
        assertThat(second.body().get("productId").asString()).isEqualTo(first.toString());
        assertThat(second.body().get("code").asString()).isEqualTo(shared);
        // The failed creation leaves nothing behind: no product, no other code, no hole in the change feed.
        assertThat(admin.queryForObject("SELECT count(*) FROM product_code WHERE tenant_id = ? AND code = ?", Long.class, tenant, shared)).isEqualTo(1L);
        assertThat(admin.queryForObject("SELECT last_seq FROM catalog_change_counter WHERE tenant_id = ?", Long.class, tenant)).isEqualTo(seqBefore);
    }

    @Test
    void twoBusinessesMayUseTheSameCode() {
        String shared = unique("SAME");
        UUID otherTenant = seedTenant();
        Actor otherOwner = seedActor(otherTenant, Role.OWNER, true);

        createdId(create(owner, product(unique("A "), "piece", List.of(code(shared, "barcode")), List.of())));
        createdId(create(otherOwner, product(unique("B "), "piece", List.of(code(shared, "barcode")), List.of())));
    }

    @Test
    void aCodeMovesToAnotherProductOnlyAfterItIsReleased() {
        String code = unique("MOVE");
        UUID first = createdId(create(owner, product(unique("Uno "), "piece", List.of(code(code, "barcode")), List.of())));
        UUID second = createdId(create(owner, product(unique("Dos "), "piece", List.of(), List.of())));

        Reply taken = call(owner, HttpMethod.PATCH, "/products/" + second, Map.of("codes", List.of(code(code, "barcode"))), null);
        assertThat(taken.status()).isEqualTo(409);

        assertThat(call(owner, HttpMethod.PATCH, "/products/" + first, Map.of("codes", List.of()), null).status()).isEqualTo(200);
        Reply moved = call(owner, HttpMethod.PATCH, "/products/" + second, Map.of("codes", List.of(code(code, "barcode"))), null);
        assertThat(moved.status()).isEqualTo(200);
        assertThat(moved.body().get("codes").get(0).get("code").asString()).isEqualTo(code);
    }

    @Test
    void whenManyRequestsRaceForTheSameCodeExactlyOneWins() throws Exception {
        String contested = unique("RACE");
        ExecutorService pool = Executors.newFixedThreadPool(6);
        try {
            List<Callable<Integer>> attempts = new ArrayList<>();
            for (int i = 0; i < 6; i++) {
                String name = unique("Carrera ");
                attempts.add(() -> create(owner, product(name, "piece", List.of(code(contested, "barcode")), List.of())).status());
            }
            List<Integer> statuses = new ArrayList<>();
            for (Future<Integer> future : pool.invokeAll(attempts)) {
                statuses.add(future.get());
            }

            assertThat(statuses).filteredOn(status -> status == 201).hasSize(1);
            assertThat(statuses).filteredOn(status -> status == 409).hasSize(5);
            assertThat(admin.queryForObject("SELECT count(*) FROM product_code WHERE tenant_id = ? AND code = ?", Long.class, tenant, contested)).isEqualTo(1L);
        } finally {
            pool.shutdownNow();
        }
    }

    // -- idempotency, editing and the unit ---------------------------------------------------------------------

    @Test
    void repeatingACreationWithTheSameKeyReturnsTheSameProduct() {
        UUID key = UUID.randomUUID();
        Map<String, Object> body = product(unique("Martillo "), "piece", List.of(code(unique("MAR"), "barcode")), List.of());

        Reply first = call(owner, HttpMethod.POST, "/products", body, key);
        Reply retry = call(owner, HttpMethod.POST, "/products", body, key);

        assertThat(first.status()).isEqualTo(201);
        assertThat(retry.status()).isEqualTo(200);
        assertThat(retry.body().get("id").asString()).isEqualTo(first.body().get("id").asString());
        assertThat(admin.queryForObject("SELECT count(*) FROM product WHERE tenant_id = ? AND idempotency_key = ?", Long.class, tenant, key)).isEqualTo(1L);
        assertThat(call(owner, HttpMethod.POST, "/products", body, null).status()).as("the key is required").isEqualTo(400);
    }

    @Test
    void theBaseUnitNeverChanges() {
        UUID id = createdId(create(owner, product(unique("Cinta "), "meter", List.of(), List.of())));

        assertThat(call(owner, HttpMethod.PATCH, "/products/" + id, Map.of("unit", "kilogram"), null).status()).isEqualTo(400);
        assertThat(call(owner, HttpMethod.PATCH, "/products/" + id, Map.of("unit", "meter", "name", "Cinta métrica"), null).status()).isEqualTo(200);
    }

    @Test
    void anEditChangesOnlyWhatItSendsAndAnEmptyEditWritesNothing() {
        UUID id = createdId(create(owner, product(unique("Lija "), "piece", List.of(code(unique("LIJ"), "barcode")), List.of())));
        long seq = call(owner, HttpMethod.GET, "/products/" + id, null, null).body().get("changeSeq").asLong();

        Reply unchanged = call(owner, HttpMethod.PATCH, "/products/" + id, Map.of(), null);
        assertThat(unchanged.body().get("changeSeq").asLong()).isEqualTo(seq);

        Reply renamed = call(owner, HttpMethod.PATCH, "/products/" + id, Map.of("status", "inactive"), null);
        assertThat(renamed.body().get("status").asString()).isEqualTo("inactive");
        assertThat(renamed.body().get("codes")).hasSize(1);
        assertThat(renamed.body().get("changeSeq").asLong()).isGreaterThan(seq);
        assertThat(admin.queryForObject("SELECT count(*) FROM audit_log WHERE entity_id = ? AND action = 'product.updated'", Long.class, id)).isEqualTo(1L);
    }

    // -- search ------------------------------------------------------------------------------------------------

    @Test
    void searchByNameIgnoresCaseAndAccentsAndPaginates() {
        UUID searchTenant = seedTenant();
        Actor searcher = seedActor(searchTenant, Role.OWNER, true);
        for (int i = 1; i <= 5; i++) {
            createdId(create(searcher, product("Tornillo hexagonal " + i, "piece", List.of(code("TOR" + i, "barcode")), List.of())));
        }
        createdId(create(searcher, product("Camión de juguete", "piece", List.of(), List.of())));

        Reply firstPage = call(searcher, HttpMethod.GET, "/products?q=TORNILLO&page=0&size=2", null, null);
        Reply lastPage = call(searcher, HttpMethod.GET, "/products?q=tornillo&page=2&size=2", null, null);
        Reply accents = call(searcher, HttpMethod.GET, "/products?q=camion", null, null);
        Reply byCode = call(searcher, HttpMethod.GET, "/products?q=TOR3", null, null);
        Reply everything = call(searcher, HttpMethod.GET, "/products?size=100", null, null);

        assertThat(firstPage.body().get("total").asInt()).isEqualTo(5);
        assertThat(firstPage.body().get("items")).hasSize(2);
        assertThat(firstPage.body().get("items").get(0).get("name").asString()).isEqualTo("Tornillo hexagonal 1");
        assertThat(lastPage.body().get("items")).hasSize(1);
        assertThat(lastPage.body().get("items").get(0).get("name").asString()).isEqualTo("Tornillo hexagonal 5");
        assertThat(accents.body().get("items").get(0).get("name").asString()).isEqualTo("Camión de juguete");
        assertThat(byCode.body().get("items")).hasSize(1);
        assertThat(everything.body().get("total").asInt()).isEqualTo(6);
        assertThat(call(searcher, HttpMethod.GET, "/products?q=100%25", null, null).body().get("total").asInt())
                .as("a percent sign is text, not a wildcard").isZero();
        assertThat(call(searcher, HttpMethod.GET, "/products?size=101", null, null).status()).isEqualTo(400);
        assertThat(call(searcher, HttpMethod.GET, "/products?page=-1", null, null).status()).isEqualTo(400);
    }

    // -- logical delete ----------------------------------------------------------------------------------------

    @Test
    void aDeletedProductDisappearsFromReadsButItsRowAndCodesStay() {
        String code = unique("GONE");
        UUID id = createdId(create(owner, product(unique("Descontinuado "), "piece", List.of(code(code, "barcode")), List.of())));

        assertThat(call(owner, HttpMethod.DELETE, "/products/" + id, null, null).status()).isEqualTo(204);

        assertThat(call(owner, HttpMethod.GET, "/products/" + id, null, null).status()).isEqualTo(404);
        assertThat(call(owner, HttpMethod.GET, "/products?q=" + code, null, null).body().get("total").asInt()).isZero();
        assertThat(call(owner, HttpMethod.PATCH, "/products/" + id, Map.of("name", "Nuevo nombre"), null).status()).isEqualTo(404);
        assertThat(call(owner, HttpMethod.DELETE, "/products/" + id, null, null).status()).as("deleting twice is harmless").isEqualTo(204);
        assertThat(call(owner, HttpMethod.DELETE, "/products/" + UUID.randomUUID(), null, null).status()).isEqualTo(404);
        assertThat(admin.queryForObject("SELECT deleted_at IS NOT NULL FROM product WHERE id = ?", Boolean.class, id)).isTrue();
        // The code stays with the deleted product, so a sale that already used it keeps its meaning.
        assertThat(create(owner, product(unique("Otro "), "piece", List.of(code(code, "barcode")), List.of())).status()).isEqualTo(409);
        assertThat(admin.queryForObject("SELECT count(*) FROM audit_log WHERE entity_id = ? AND action = 'product.deleted'", Long.class, id)).isEqualTo(1L);
    }

    // -- roles and isolation -----------------------------------------------------------------------------------

    @Test
    void aCashierReadsButCannotWrite() {
        UUID id = createdId(create(owner, product(unique("Pala "), "piece", List.of(), List.of())));

        assertThat(call(cashier, HttpMethod.GET, "/products", null, null).status()).isEqualTo(200);
        assertThat(call(cashier, HttpMethod.GET, "/products/" + id, null, null).status()).isEqualTo(200);
        assertThat(create(cashier, product(unique("Prohibido "), "piece", List.of(), List.of())).status()).isEqualTo(403);
        assertThat(call(cashier, HttpMethod.PATCH, "/products/" + id, Map.of("name", "Otro"), null).status()).isEqualTo(403);
        assertThat(call(cashier, HttpMethod.DELETE, "/products/" + id, null, null).status()).isEqualTo(403);
        assertThat(call(owner, HttpMethod.GET, "/products/" + id, null, null).body().get("name").asString()).startsWith("Pala ");
        assertThat(create(manager, product(unique("Permitido "), "piece", List.of(), List.of())).status()).isEqualTo(201);
    }

    @Test
    void aBusinessNeverSeesTheProductsOfAnother() {
        String code = unique("PRIV");
        UUID mine = createdId(create(owner, product(unique("Privado "), "piece", List.of(code(code, "barcode")), List.of())));
        Actor stranger = seedActor(seedTenant(), Role.OWNER, true);

        assertThat(call(stranger, HttpMethod.GET, "/products/" + mine, null, null).status()).isEqualTo(404);
        assertThat(call(stranger, HttpMethod.PATCH, "/products/" + mine, Map.of("name", "Robado"), null).status()).isEqualTo(404);
        assertThat(call(stranger, HttpMethod.DELETE, "/products/" + mine, null, null).status()).isEqualTo(404);
        assertThat(call(stranger, HttpMethod.GET, "/products?q=" + code, null, null).body().get("total").asInt()).isZero();
        assertThat(admin.queryForObject("SELECT name FROM product WHERE id = ?", String.class, mine)).startsWith("Privado ");
    }

    // -- audit, change feed and events -------------------------------------------------------------------------

    @Test
    void everyChangeIsAuditedWithTheUserWhoMadeIt() {
        UUID id = createdId(create(manager, product(unique("Auditado "), "liter", List.of(code(unique("AUD"), "barcode")), List.of())));
        call(owner, HttpMethod.PATCH, "/products/" + id, Map.of("name", "Auditado y renombrado"), null);

        Map<String, Object> created = admin.queryForMap(
                "SELECT actor_id, new_value::text AS new_value FROM audit_log WHERE entity_id = ? AND action = 'product.created'", id);
        assertThat(created.get("actor_id")).isEqualTo(manager.id());
        assertThat(created.get("new_value").toString()).contains("liter", "Auditado");
        Map<String, Object> updated = admin.queryForMap("""
                SELECT actor_id, old_value::text AS old_value, new_value::text AS new_value
                FROM audit_log WHERE entity_id = ? AND action = 'product.updated'
                """, id);
        assertThat(updated.get("actor_id")).isEqualTo(owner.id());
        assertThat(updated.get("old_value").toString()).doesNotContain("renombrado");
        assertThat(updated.get("new_value").toString()).contains("renombrado");
    }

    @Test
    void theChangeFeedGrowsByOneForEachChangeInsideTheBusiness() {
        UUID feedTenant = seedTenant();
        Actor feedOwner = seedActor(feedTenant, Role.OWNER, true);

        UUID first = createdId(create(feedOwner, product("Uno", "piece", List.of(), List.of())));
        UUID second = createdId(create(feedOwner, product("Dos", "piece", List.of(), List.of())));
        call(feedOwner, HttpMethod.PATCH, "/products/" + first, Map.of("name", "Uno editado"), null);
        call(feedOwner, HttpMethod.DELETE, "/products/" + second, null, null);

        List<Long> positions = admin.queryForList(
                "SELECT change_seq FROM product WHERE tenant_id = ? ORDER BY change_seq", Long.class, feedTenant);
        assertThat(positions).containsExactly(3L, 4L);
        assertThat(admin.queryForObject("SELECT last_seq FROM catalog_change_counter WHERE tenant_id = ?", Long.class, feedTenant)).isEqualTo(4L);
    }

    @Test
    void creatingEditingAndDeletingEachLeaveAnEventInTheOutboxWithTheirTransaction() {
        UUID id = createdId(create(owner, product(unique("Evento "), "meter", List.of(code(unique("EVT"), "barcode")), List.of())));
        assertThat(eventsOf(id, "ProductCreated")).hasSize(1);
        assertThat(eventsOf(id, "ProductUpdated")).isEmpty();

        call(owner, HttpMethod.PATCH, "/products/" + id, Map.of("name", "Evento editado"), null);
        call(owner, HttpMethod.PATCH, "/products/" + id, Map.of("name", "Evento editado"), null);
        call(owner, HttpMethod.DELETE, "/products/" + id, null, null);

        List<String> updates = eventsOf(id, "ProductUpdated");
        assertThat(updates).as("the repeated edit changed nothing, so it emitted nothing").hasSize(2);
        assertThat(updates).anySatisfy(event -> assertThat(event).contains("\"deleted\":true"));
        assertThat(eventsOf(id, "ProductCreated").get(0)).contains(tenant.toString(), "\"schemaVersion\":1", "\"unit\":\"meter\"");
    }

    @Test
    void aRejectedCreationLeavesNoEvent() {
        String code = unique("NOEVT");
        createdId(create(owner, product(unique("Existente "), "piece", List.of(code(code, "barcode")), List.of())));
        String name = unique("Rechazado ");

        assertThat(create(owner, product(name, "piece", List.of(code(code, "barcode")), List.of())).status()).isEqualTo(409);

        assertThat(admin.queryForObject("SELECT count(*) FROM event_publication WHERE serialized_event LIKE ?", Long.class, "%" + name + "%")).isZero();
    }

    private List<String> eventsOf(UUID productId, String type) {
        return admin.queryForList("SELECT serialized_event FROM event_publication WHERE event_type LIKE ? AND serialized_event LIKE ?",
                String.class, "%." + type, "%" + productId + "%");
    }
}
