package io.github.mauriciotorrez1.pos.core.catalog;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.mauriciotorrez1.pos.core.identity.Role;
import io.github.mauriciotorrez1.pos.security.SecuredApiTest;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Loading the catalog from a file (F0-18, RF-005) and changing prices in bulk (F0-19, RF-006). */
class CatalogToolsApiTest extends SecuredApiTest {

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

    private record Answer(int status, JsonNode body, String text) {
    }

    private Answer importCsv(Actor actor, String query, String csv) {
        var result = client.method(HttpMethod.POST).uri("/imports/catalog" + query).header("Authorization", actor.bearer())
                .contentType(MediaType.parseMediaType("text/csv")).body(csv).exchange().expectBody(String.class).returnResult();
        String text = result.getResponseBody();
        boolean isJson = text != null && text.startsWith("{");
        return new Answer(result.getStatus().value(), isJson ? json.readTree(text) : null, text);
    }

    private Answer changePrices(Actor actor, Map<String, Object> body) {
        var result = client.method(HttpMethod.POST).uri("/price-changes").header("Authorization", actor.bearer())
                .contentType(MediaType.APPLICATION_JSON).body(json.writeValueAsString(body)).exchange()
                .expectBody(String.class).returnResult();
        String text = result.getResponseBody();
        return new Answer(result.getStatus().value(), text == null || text.isBlank() ? null : json.readTree(text), text);
    }

    private long priceOf(String code) {
        return admin.queryForObject("""
                SELECT p.unit_price_e4 FROM product p JOIN product_code c ON c.product_id = p.id
                WHERE c.code = ? AND p.tenant_id = ?
                """, Long.class, code, tenant);
    }

    private long productsNamed(String prefix) {
        return admin.queryForObject("SELECT count(*) FROM product WHERE tenant_id = ? AND name LIKE ?", Long.class, tenant,
                prefix + "%");
    }

    // -- import -----------------------------------------------------------------------------------------------

    @Test
    void aFileLoadsItsGoodRowsAndReportsTheBadOnesByLine() {
        String csv = """
                Código del producto;Nombre del producto;Precio de Venta;Unidad;IVA;Costo con IVA;Existencias
                IMP-A1;Importado martillo;135.50;pieza;16;90;4
                IMP-A2;Importado cable;12.5;metro;;8;100
                ;Importado sin código;10;;;;
                IMP-A4;Importado precio malo;doce;;;;
                IMP-A5;Importado unidad rara;10;caja;;;
                IMP-A1;Importado repetido;99;;;;
                """;

        Answer answer = importCsv(owner, "", csv);

        assertThat(answer.status()).as(answer.text()).isEqualTo(200);
        assertThat(answer.body().get("rowsRead").asInt()).isEqualTo(6);
        assertThat(answer.body().get("created").asInt()).isEqualTo(2);
        assertThat(answer.body().get("invalid").size()).isEqualTo(4);
        assertThat(answer.body().get("invalid").get(0).get("line").asInt()).isEqualTo(4);
        assertThat(answer.body().get("invalid").get(3).get("reason").asString()).contains("repetido");
        assertThat(answer.body().get("ignoredColumns").toString()).contains("Costo con IVA").contains("Existencias");
        assertThat(priceOf("IMP-A1")).isEqualTo(1_355_000L);
        assertThat(priceOf("IMP-A2")).isEqualTo(125_000L);
        assertThat(admin.queryForObject("""
                SELECT p.unit FROM product p JOIN product_code c ON c.product_id = p.id WHERE c.code = 'IMP-A2' AND p.tenant_id = ?
                """, String.class, tenant)).isEqualTo("meter");
        // The other tests of this class import into the same business, so the count is at least this one.
        assertThat(admin.queryForObject("SELECT count(*) FROM audit_log WHERE tenant_id = ? AND action = 'catalog.imported'",
                Long.class, tenant)).isPositive();
    }

    @Test
    void loadingTheSameFileAgainCreatesNothing() {
        String csv = "codigo,nombre,precio\nIMP-B1,Repetible uno,10\nIMP-B2,Repetible dos,20\n";

        assertThat(importCsv(owner, "", csv).body().get("created").asInt()).isEqualTo(2);
        Answer again = importCsv(owner, "", csv);

        assertThat(again.body().get("created").asInt()).isZero();
        assertThat(again.body().get("alreadyThere").asInt()).isEqualTo(2);
        assertThat(productsNamed("Repetible")).isEqualTo(2L);
    }

    @Test
    void aDryRunSaysWhatWouldHappenAndSavesNothing() {
        Answer answer = importCsv(owner, "?dryRun=true", "codigo,nombre,precio\nIMP-C1,Ensayo uno,10\nIMP-C2,,20\n");

        assertThat(answer.body().get("dryRun").asBoolean()).isTrue();
        assertThat(answer.body().get("created").asInt()).isEqualTo(1);
        assertThat(answer.body().get("invalid").size()).isEqualTo(1);
        assertThat(productsNamed("Ensayo")).isZero();
    }

    @Test
    void theRowsThatFailedComeAsAFileWhenAsked() {
        Answer answer = importCsv(owner, "?dryRun=true&report=csv", "codigo,nombre,precio\nIMP-D1,Reporte uno,x\n");

        assertThat(answer.status()).isEqualTo(200);
        assertThat(answer.text()).startsWith("linea,motivo\n2,\"");
    }

    @Test
    void aManagerLoadsProductsWithoutTheirPriceAndACashierLoadsNothing() {
        Answer answer = importCsv(manager, "", "codigo,nombre,precio\nIMP-E1,Encargado uno,50\n");

        assertThat(answer.body().get("created").asInt()).isEqualTo(1);
        assertThat(answer.body().get("pricesSkipped").asInt()).isEqualTo(1);
        assertThat(priceOf("IMP-E1")).isZero();
        assertThat(importCsv(cashier, "", "codigo,nombre,precio\nIMP-E2,Cajero uno,50\n").status()).isEqualTo(403);
    }

    @Test
    void aFileWithoutTheRequiredTitlesIsRefusedWithHowToWriteThem() {
        Answer answer = importCsv(owner, "", "clave interna,algo\n1,x\n");

        assertThat(answer.status()).isEqualTo(400);
        assertThat(answer.text()).contains("Código del producto, Nombre del producto, Precio de venta");
    }

    // -- bulk price change ------------------------------------------------------------------------------------

    @Test
    void aBulkChangeIsPreviewedThenAppliedToEveryMatchWithAuditHistoryAndFeed() {
        importCsv(owner, "", "codigo,nombre,precio\nBLK-1,Truperx martillo,100\nBLK-2,Truperx pinza,49.99\nBLK-3,Otra marca,10\n");
        Map<String, Object> change = Map.of("search", "truperx", "percent", "5", "preview", true);

        Answer preview = changePrices(owner, change);

        assertThat(preview.status()).as(preview.text()).isEqualTo(200);
        assertThat(preview.body().get("applied").asBoolean()).isFalse();
        assertThat(preview.body().get("count").asInt()).isEqualTo(2);
        assertThat(preview.body().get("lines").get(0).get("newPrice").asString()).isEqualTo("105.0000");
        assertThat(priceOf("BLK-1")).isEqualTo(1_000_000L);

        Answer applied = changePrices(owner, Map.of("search", "truperx", "percent", "5", "expectedCount", 2));

        assertThat(applied.status()).as(applied.text()).isEqualTo(200);
        assertThat(applied.body().get("applied").asBoolean()).isTrue();
        assertThat(priceOf("BLK-1")).isEqualTo(1_050_000L);
        // 49.99 * 1.05 = 52.4895, to the cent 52.49.
        assertThat(priceOf("BLK-2")).isEqualTo(524_900L);
        assertThat(priceOf("BLK-3")).isEqualTo(100_000L);
        assertThat(admin.queryForObject("SELECT count(*) FROM audit_log WHERE tenant_id = ? AND action = 'price.bulk_change'",
                Long.class, tenant)).isEqualTo(1L);
        assertThat(admin.queryForObject("""
                SELECT count(*) FROM product_price_history h JOIN product_code c ON c.product_id = h.product_id
                WHERE c.code IN ('BLK-1', 'BLK-2') AND h.tenant_id = ? AND h.previous_unit_price_e4 IS NOT NULL
                """, Long.class, tenant)).isEqualTo(2L);
    }

    @Test
    void aBulkChangeIsRefusedWholeWhenTheCatalogMovedSinceThePreview() {
        importCsv(owner, "", "codigo,nombre,precio\nSTL-1,Movidox uno,100\nSTL-2,Movidox dos,200\n");

        Answer answer = changePrices(owner, Map.of("search", "movidox", "percent", "10", "expectedCount", 1));

        assertThat(answer.status()).isEqualTo(409);
        assertThat(answer.body().get("actualCount").asInt()).isEqualTo(2);
        assertThat(priceOf("STL-1")).isEqualTo(1_000_000L);
        assertThat(priceOf("STL-2")).isEqualTo(2_000_000L);
    }

    @Test
    void onlyTheOwnerChangesPricesInBulkAndTheRequestIsChecked() {
        Map<String, Object> change = Map.of("percent", "5", "preview", true);

        assertThat(changePrices(manager, change).status()).isEqualTo(403);
        assertThat(changePrices(cashier, change).status()).isEqualTo(403);
        assertThat(changePrices(owner, Map.of("percent", "0", "preview", true)).status()).isEqualTo(400);
        assertThat(changePrices(owner, Map.of("percent", "cinco", "preview", true)).status()).isEqualTo(400);
        assertThat(changePrices(owner, Map.of("percent", "5", "rounding", "dollar", "preview", true)).status()).isEqualTo(400);
        assertThat(changePrices(owner, Map.of("percent", "5")).status()).isEqualTo(400);
    }

    @Test
    void thePricesRoundHalfUpToTheStepAndNeverReachZero() {
        assertThat(BulkPriceChange.newPrice(499_900, 500, BulkPriceChange.Rounding.CENT)).isEqualTo(524_900L);
        assertThat(BulkPriceChange.newPrice(1_000_000, -250, BulkPriceChange.Rounding.CENT)).isEqualTo(975_000L);
        assertThat(BulkPriceChange.newPrice(1_023_000, 500, BulkPriceChange.Rounding.HALF_PESO)).isEqualTo(1_075_000L);
        assertThat(BulkPriceChange.newPrice(1_023_000, 500, BulkPriceChange.Rounding.PESO)).isEqualTo(1_070_000L);
        assertThat(BulkPriceChange.newPrice(100, -9_000, BulkPriceChange.Rounding.PESO)).isEqualTo(10_000L);
    }
}
