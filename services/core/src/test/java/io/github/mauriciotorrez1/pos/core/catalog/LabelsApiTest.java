package io.github.mauriciotorrez1.pos.core.catalog;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.mauriciotorrez1.pos.core.identity.Role;
import io.github.mauriciotorrez1.pos.security.SecuredApiTest;
import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.openpdf.text.pdf.PdfReader;
import org.openpdf.text.pdf.parser.PdfTextExtractor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import tools.jackson.databind.json.JsonMapper;

/** Printing shelf labels as a PDF (F0-22, RF-007) through the API, with the real database and token. */
class LabelsApiTest extends SecuredApiTest {

    @Autowired
    private JsonMapper json;

    private UUID tenant;
    private Actor owner;
    private Actor cashier;

    @BeforeAll
    void seed() {
        tenant = seedTenant();
        owner = seedActor(tenant, Role.OWNER, true);
        cashier = seedActor(tenant, Role.CASHIER, true);
        String csv = """
                codigo,nombre,precio,unidad
                7501031311309,Etiquetax refresco,20,pieza
                LBL-CABLE,Etiquetax cable,12.5,metro
                LBL-OTRO,Otro producto,99,pieza
                """;
        int status = client.method(HttpMethod.POST).uri("/imports/catalog").header("Authorization", owner.bearer())
                .contentType(MediaType.parseMediaType("text/csv")).body(csv).exchange().returnResult().getStatus().value();
        assertThat(status).isEqualTo(200);
    }

    private record Answer(int status, byte[] body, HttpHeaders headers) {
        String text() {
            return body == null ? "" : new String(body, java.nio.charset.StandardCharsets.UTF_8);
        }
    }

    private Answer print(Actor actor, Map<String, Object> request) {
        var call = client.method(HttpMethod.POST).uri("/labels");
        if (actor != null) {
            call = call.header("Authorization", actor.bearer());
        }
        var result = call.contentType(MediaType.APPLICATION_JSON).body(json.writeValueAsString(request)).exchange()
                .expectBody(byte[].class).returnResult();
        return new Answer(result.getStatus().value(), result.getResponseBody(), result.getResponseHeaders());
    }

    private UUID idOf(String code) {
        return admin.queryForObject("SELECT product_id FROM product_code WHERE code = ? AND tenant_id = ?", UUID.class,
                code, tenant);
    }

    private static String pdfText(byte[] pdf) throws IOException {
        try (PdfReader reader = new PdfReader(pdf)) {
            StringBuilder text = new StringBuilder();
            PdfTextExtractor extractor = new PdfTextExtractor(reader);
            for (int page = 1; page <= reader.getNumberOfPages(); page++) {
                text.append(extractor.getTextFromPage(page)).append('\n');
            }
            return text.toString();
        }
    }

    @Test
    void aSearchBecomesAPdfWithTheNamePriceAndCodeOfEachMatch() throws IOException {
        Answer answer = print(owner, Map.of("search", "etiquetax"));

        assertThat(answer.status()).as(answer.text()).isEqualTo(200);
        assertThat(answer.headers().getContentType()).isEqualTo(MediaType.APPLICATION_PDF);
        assertThat(answer.headers().getFirst(HttpHeaders.CONTENT_DISPOSITION)).contains("attachment").contains("etiquetas.pdf");
        assertThat(answer.headers().getFirst("X-Label-Count")).isEqualTo("2");
        String text = pdfText(answer.body());
        assertThat(text).contains("Etiquetax refresco", "$20.00", "Etiquetax cable", "$12.50 / m", "LBL-CABLE")
                .doesNotContain("Otro producto");
        assertThat(text.replace(" ", "")).contains("7501031311309");
    }

    @Test
    void chosenProductsArePrintedInTheirOrderWithTheirCopies() throws IOException {
        Answer answer = print(owner, Map.of("productIds", List.of(idOf("LBL-OTRO"), idOf("LBL-CABLE")), "copies", 3));

        assertThat(answer.status()).as(answer.text()).isEqualTo(200);
        assertThat(answer.headers().getFirst("X-Label-Count")).isEqualTo("6");
        String text = pdfText(answer.body());
        assertThat(text.indexOf("Otro producto")).isLessThan(text.indexOf("Etiquetax cable"));
    }

    @Test
    void aCashierPrintsLabelsButSomeoneWithoutUserOrTokenDoesNot() {
        assertThat(print(cashier, Map.of("search", "etiquetax")).status()).isEqualTo(200);
        assertThat(print(seedLoginWithoutUser(tenant), Map.of("search", "etiquetax")).status()).isEqualTo(403);
        assertThat(print(null, Map.of("search", "etiquetax")).status()).isEqualTo(401);
    }

    @Test
    void aProductOfAnotherBusinessIsNotFound() {
        UUID otherTenant = seedTenant();
        Actor otherOwner = seedActor(otherTenant, Role.OWNER, true);

        assertThat(print(otherOwner, Map.of("productIds", List.of(idOf("LBL-CABLE")))).status()).isEqualTo(404);
    }

    @Test
    void theRequestIsChecked() {
        assertThat(print(owner, Map.of()).status()).isEqualTo(400);
        assertThat(print(owner, Map.of("search", "no existe nada asi")).status()).isEqualTo(400);
        assertThat(print(owner, Map.of("search", "etiquetax", "copies", 0)).status()).isEqualTo(400);
        assertThat(print(owner, Map.of("search", "etiquetax", "copies", 25)).status()).isEqualTo(400);
        assertThat(print(owner, Map.of("search", "etiquetax", "layout", "rollo-termico")).status()).isEqualTo(400);
        // 2 products by 24 copies is 48 labels, inside the limit; the limit itself is checked before any drawing.
        assertThat(print(owner, Map.of("search", "etiquetax", "copies", 24)).status()).isEqualTo(200);
    }
}
